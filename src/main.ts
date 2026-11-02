import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { stars, tickClock, winCoins } from './sim/economy';
import { feedback } from './sim/feel';
import { generateLevel } from './sim/levelgen';
import { applyMove, analyze, canMove, makeState, occupancy, pieceActive, settlePaint, stranded, won } from './sim/rules';
import { solve } from './sim/solver';
import { SHAPES } from './sim/shapes';
import { DX, DY, type Dir, type Level, type SimState } from './sim/types';
import { AudioBus } from './game/audio';
import { Haptics } from './game/haptics';
import { burst, geomFor, paintColor, render, stepFx, voxel, wallFor, type Floater, type Frame, type Geom, type Particle } from './game/render';
import { load, write, type Save, type Settings, type Snapshot } from './game/save';

registerSW({ immediate: true });
// Drop the cache-busting query left by "Update now".
if (new URLSearchParams(location.search).has('u')) history.replaceState(null, '', location.pathname);

/** Unregister the service worker, clear its caches, and reload past the HTTP cache. */
async function forceUpdate() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } finally {
    location.replace(`${location.pathname}?u=${Date.now()}`);
  }
}

type Mode = 'title' | 'levels' | 'play' | 'pause' | 'win' | 'fail' | 'help' | 'settings';

interface Live {
  /** Drawn position, eased toward tx/ty every frame. */
  x: number;
  y: number;
  tx: number;
  ty: number;
  out: boolean;
  lift: number;
  flash: number;
  squash: number;
}
interface ExitAnim {
  i: number;
  dir: Dir;
  t: number;
  x: number;
  y: number;
  /** Cells to travel so the brick fully passes the tray edge. */
  dist: number;
  /** Seconds for the slide-out. */
  dur: number;
  /** Cells between the start and the last fully-on-tray position. */
  toEdge: number;
  /** Fraction of the brick already broken into voxels. */
  spawned: number;
}
/** Everything an undo restores. */
interface Undo {
  x: Int16Array;
  y: Int16Array;
  out: Uint8Array;
  color: Uint8Array;
  passed: Uint8Array;
  clears: number;
  keys: number;
  moves: number;
}

interface Drag {
  /** Position before this drag, for undo. */
  pre: Undo;
  i: number;
  pid: number;
  /** Grab point relative to the brick origin, in cells. */
  gx: number;
  gy: number;
  /** Brick position in cells. One axis is always whole. */
  px: number;
  py: number;
  /** Occupancy at grab time. Other bricks do not move during a drag. */
  occ: Uint8Array;
  /** Release velocity estimate, cells per second. */
  vx: number;
  vy: number;
  t: number;
  moved: boolean;
}
interface Session {
  level: Level;
  sim: SimState;
  live: Live[];
  timeLeft: number;
  freeze: number;
  boosters: number;
  drag: Drag | null;
  exiting: ExitAnim | null;
  over: boolean;
  geom: Geom;
  frame: Frame;
  hintFor: number;
  gained: number;
  /** Set when an exit through a limited gate left the tray unsolvable. */
  stuck: boolean;
  /** Drags made, counted against par. */
  moves: number;
  history: Undo[];
}

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const ctx = canvas.getContext('2d')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const screens = document.querySelector<HTMLElement>('#screens')!;
const hintEl = document.querySelector<HTMLElement>('#hint')!;
const audio = new AudioBus();
const haptics = new Haptics();

let save: Save = load();
audio.enabled = save.settings.sound;
haptics.enabled = save.settings.haptics;
let mode: Mode = 'title';
/** Where Settings should return to. Pause opens Settings too. */
let settingsBack: Mode = 'title';
let chapter = 0;
let session: Session | null = null;
/** Shown on the home screen: package version, commit and build time. */
const VERSION_LABEL = `v${__APP_VERSION__} · ${__BUILD_SHA__} · ${new Date(__BUILD_TIME__).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;

function safeInsets() {
  const probe = document.querySelector<HTMLElement>('#safe-probe')!;
  const cs = getComputedStyle(probe);
  return { top: parseFloat(cs.paddingTop) || 0, bot: parseFloat(cs.paddingBottom) || 0 };
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (session) fit(session);
}

function fit(s: Session) {
  const safe = safeInsets();
  s.geom = geomFor(window.innerWidth, window.innerHeight, s.level.w, s.level.h, safe.top, safe.bot);
}

function freshFrame(level: Level, live: Live[], sim: SimState): Frame {
  return {
    level,
    pieces: live,
    colors: sim.color,
    passed: sim.passed,
    clears: 0,
    keys: 0,
    shake: 0,
    particles: [] as Particle[],
    texts: [] as Floater[],
    dragId: -1,
    flights: [],
    exitId: -1,
    hoverId: -1,
    symbols: save.settings.symbols,
    reduce: save.settings.reduceMotion,
    time: 0,
  };
}

/** Finished levels from the worker, and requests still in flight. */
const built = new Map<number, Level>();
const waiting = new Map<number, ((level: Level) => void)[]>();
let worker: Worker | null = null;
try {
  worker = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ n: number; level: Level }>) => {
    built.set(e.data.n, e.data.level);
    for (const done of waiting.get(e.data.n) ?? []) done(e.data.level);
    waiting.delete(e.data.n);
  };
  worker.onerror = () => {
    worker = null;
  };
} catch {
  worker = null;
}

/** Ask the worker for a level. Without a worker, build it here. */
function requestLevel(n: number): Promise<Level> {
  const have = built.get(n);
  if (have) return Promise.resolve(have);
  if (!worker) {
    const level = generateLevel(n);
    built.set(n, level);
    return Promise.resolve(level);
  }
  return new Promise((resolve) => {
    const list = waiting.get(n);
    if (list) list.push(resolve);
    else {
      waiting.set(n, [resolve]);
      worker!.postMessage(n);
    }
  });
}

let startToken = 0;
// Start on the level the home screen offers, so Play is usually instant.
void requestLevel(save.snapshot?.n ?? save.unlocked);

function startLevel(n: number, resume = false) {
  const token = ++startToken;
  const ready = built.get(n);
  if (ready) return beginLevel(ready, resume);
  // Not built yet: show a card, and start when the worker is done unless the player moved on.
  const card = el(`<div class="screen solid"><div class="card panel"><p class="eyebrow">Level ${n}</p><h1 class="sheet-title">Building level</h1><p class="sub">Searching for a good one.</p></div></div>`);
  screens.innerHTML = '';
  screens.append(card);
  void requestLevel(n).then((level) => {
    if (token === startToken && card.isConnected) beginLevel(level, resume);
  });
}

function beginLevel(level: Level, resume: boolean) {
  const n = level.n;
  const sim = makeState(level);
  const snap = resume ? save.snapshot : null;
  if (snap && snap.n === n && snap.x.length === level.pieces.length) {
    for (let i = 0; i < sim.x.length; i++) {
      sim.x[i] = snap.x[i];
      sim.y[i] = snap.y[i];
      sim.out[i] = snap.out[i] ? 1 : 0;
    }
    sim.clears = snap.out.reduce((a, b) => a + (b ? 1 : 0), 0);
    sim.keys = level.pieces.reduce((a, p, i) => a + (snap.out[i] ? p.keys : 0), 0);
    if (snap.color?.length === sim.color.length) sim.color.set(snap.color);
    if (snap.passed?.length === sim.passed.length) sim.passed.set(snap.passed);
  }
  const live = level.pieces.map((_, i) => ({ x: sim.x[i], y: sim.y[i], tx: sim.x[i], ty: sim.y[i], out: !!sim.out[i], lift: 0, flash: 0, squash: 0 }));
  session = {
    level,
    sim,
    live,
    timeLeft: snap && snap.n === n ? snap.timeLeft : level.timer,
    freeze: snap && snap.n === n ? snap.freeze : 0,
    boosters: snap && snap.n === n ? snap.boosters : 0,
    drag: null,
    exiting: null,
    over: false,
    geom: geomFor(1, 1, 1, 1, 0, 0),
    frame: freshFrame(level, live, sim),
    hintFor: 2.6,
    stuck: false,
    moves: snap && snap.n === n ? (snap.moves ?? 0) : 0,
    history: [],
    gained: 0,
  };
  session.frame.clears = sim.clears;
  session.frame.keys = sim.keys;
  fit(session);
  mode = 'play';
  hintEl.textContent = level.hint;
  renderChrome();
  // Build the next two levels in the worker so "Next" opens instantly.
  void requestLevel(n + 1);
  void requestLevel(n + 2);
}

function juice(kind: string) {
  const feel = feedback(kind, save.settings.reduceMotion);
  haptics.pulse(feel.haptic);
  audio.play(kind as 'grab');
}

function pieceCenter(s: Session, i: number): { x: number; y: number } {
  const shape = SHAPES[s.level.pieces[i].shape];
  const live = s.live[i];
  return {
    x: s.geom.ox + (live.x + shape.w / 2) * s.geom.cell,
    y: s.geom.oy + (live.y + shape.h / 2) * s.geom.cell,
  };
}

function noteChanges(s: Session, beforeClears: number, beforeKeys: number) {
  const { level, sim } = s;
  for (let i = 0; i < level.pieces.length; i++) {
    const p = level.pieces[i];
    if (p.ice > 0 && beforeClears < p.ice && sim.clears >= p.ice) {
      const c = pieceCenter(s, i);
      juice('thaw');
      burst(s.frame.particles, c.x, c.y, '#dff6ff', feedback('thaw', false).particles);
    }
    if (p.lock > 0 && beforeKeys < p.lock && sim.keys >= p.lock) juice('unlock');
  }
  for (let r = 0; r < level.rooms.length; r++) {
    const room = level.rooms[r];
    if (beforeClears < room.openAfter && sim.clears >= room.openAfter) {
      const x = s.geom.ox + (room.x + room.w / 2) * s.geom.cell;
      const y = s.geom.oy + (room.y + room.h / 2) * s.geom.cell;
      juice('room');
      burst(s.frame.particles, x, y, '#ffd56a', feedback('room', false).particles);
    }
  }
}

function finishExit(s: Session, i: number) {
  const beforeC = s.sim.clears;
  const beforeK = s.sim.keys;
  const beforeP = s.sim.passed.reduce((a, b) => a + b, 0);
  const c = gatePoint(s, i, s.exiting?.dir ?? 0);
  const col = paintColor(s.level, s.sim.color[i]);
  // The brick sits on its last on-tray cell; one step in the exit direction crosses the gate.
  applyMove(s.level, s.sim, { i, dir: s.exiting?.dir ?? 0, dist: 1, exit: true });
  // A key brick sends its key to every padlock still waiting, so the link is visible.
  if (s.level.pieces[i].keys > 0) {
    for (let k = 0; k < s.level.pieces.length; k++) {
      const q = s.level.pieces[k];
      if (q.lock <= 0 || s.sim.out[k] || beforeK >= q.lock) continue;
      const to = pieceCenter(s, k);
      s.frame.flights.push({ x0: c.x, y0: c.y, x1: to.x, y1: to.y, t: 0, });
    }
  }
  s.live[i].out = true;
  s.frame.clears = s.sim.clears;
  s.frame.keys = s.sim.keys;
  if (save.settings.reduceMotion) burst(s.frame.particles, c.x, c.y, col.hex, 0);
  juice('exit');
  noteChanges(s, beforeC, beforeK);
  s.exiting = null;
  if (won(s.level, s.sim)) onWin();
  else if (s.sim.passed.reduce((a, b) => a + b, 0) > beforeP && deadEnd(s)) {
    // Let the debris land, then say what went wrong.
    s.stuck = true;
    setTimeout(() => session === s && !s.over && s.stuck && onFail(), 900);
  }
}

/** Only exits through limited gates can strand a brick. Proven dead ends only. */
function deadEnd(s: Session): boolean {
  return stranded(s.level, s.sim) || !!solve(s.level, 8000, Infinity, s.sim).exhausted;
}

/**
 * Break the part of a leaving brick that has passed the tray edge into voxels.
 * Debris sprays out of the gate's outer face, along the gate's span.
 */
function sprayVoxels(s: Session, ex: ExitAnim, passed: number) {
  if (save.settings.reduceMotion || passed <= ex.spawned) return;
  const p = s.level.pieces[ex.i];
  const shape = SHAPES[p.shape];
  const col = paintColor(s.level, s.sim.color[ex.i]);
  const { cell, ox, oy } = s.geom;
  const wall = wallFor(cell);
  const vertical = ex.dir === 0 || ex.dir === 2;
  // Roughly 9 voxels per cell of brick, capped for big bricks.
  const total = Math.min(90, shape.cells.length * 9);
  const n = Math.round(total * passed) - Math.round(total * ex.spawned);
  ex.spawned = passed;
  const from = vertical ? ox + s.sim.x[ex.i] * cell : oy + s.sim.y[ex.i] * cell;
  const span = (vertical ? shape.w : shape.h) * cell;
  // Spawn across the gate's thickness, from the tray edge to its outer face.
  const edgeX = ex.dir === 3 ? ox : ex.dir === 1 ? ox + s.level.w * cell : 0;
  const edgeY = ex.dir === 0 ? oy : ex.dir === 2 ? oy + s.level.h * cell : 0;
  const k = cell / 60;
  for (let v = 0; v < n; v++) {
    const along = from + Math.random() * span;
    const depth = Math.random() * wall;
    const x = vertical ? along : edgeX + DX[ex.dir] * depth;
    const y = vertical ? edgeY + DY[ex.dir] * depth : along;
    // A short pop outward, a wide sideways scatter, and an upward kick; gravity does the rest.
    // Outward speed stays low so debris stays on screen when a gate sits at the screen edge.
    const out = (30 + Math.random() * 110) * k;
    const side = (Math.random() - 0.5) * 260 * k;
    const vx = vertical ? side : DX[ex.dir] * out;
    const vy = vertical ? DY[ex.dir] * (60 + Math.random() * 160) * k : side * 0.4 - (120 + Math.random() * 200) * k;
    voxel(s.frame.particles, x, y, vx, vy, col.hex, col.deep, cell * (0.1 + Math.random() * 0.1));
  }
}

/** Where a leaving brick crosses the tray edge, in pixels. */
function gatePoint(s: Session, i: number, dir: Dir): { x: number; y: number } {
  const shape = SHAPES[s.level.pieces[i].shape];
  const { cell, ox, oy } = s.geom;
  const sx = s.sim.x[i];
  const sy = s.sim.y[i];
  let x = ox + (sx + shape.w / 2) * cell;
  let y = oy + (sy + shape.h / 2) * cell;
  if (dir === 0) y = oy;
  if (dir === 2) y = oy + s.level.h * cell;
  if (dir === 3) x = ox;
  if (dir === 1) x = ox + s.level.w * cell;
  return { x, y };
}

/** Start the slide-out from brick-cell (x, y), which is fully on the tray. */
function beginExit(s: Session, i: number, dir: Dir, x: number, y: number, speed = 0) {
  if (s.exiting || s.over) return;
  const live = s.live[i];
  const shape = SHAPES[s.level.pieces[i].shape];
  if (s.drag) record(s, s.drag.pre);
  s.drag = null;
  s.sim.x[i] = x;
  s.sim.y[i] = y;
  const span = dir === 0 || dir === 2 ? shape.h : shape.w;
  const from = dir === 0 || dir === 2 ? live.y : live.x;
  const edge = dir === 0 || dir === 2 ? y : x;
  const dist = span + Math.abs(edge - from) + 0.15;
  // Carry the drag speed into the exit so the brick never slows down at the gate.
  const dur = Math.max(0.2, Math.min(0.36, dist / Math.max(8, speed)));
  s.exiting = { i, dir, t: 0, x: live.x, y: live.y, dist, dur, toEdge: Math.abs(edge - from), spawned: 0 };
  s.frame.exitId = i;
  audio.play('tick');
}

/** Run `analyze` as if brick i sat at (cx, cy). */
function reach(s: Session, d: Drag, cx: number, cy: number, dir: Dir) {
  const ox0 = s.sim.x[d.i];
  const oy0 = s.sim.y[d.i];
  s.sim.x[d.i] = cx;
  s.sim.y[d.i] = cy;
  const a = analyze(s.level, s.sim, d.occ, d.i, dir);
  s.sim.x[d.i] = ox0;
  s.sim.y[d.i] = oy0;
  return a;
}

const EPS = 1e-4;
const whole = (v: number) => Math.abs(v - Math.round(v)) < EPS;

/**
 * Move the dragged brick toward (tx, ty) in cells, sliding along free lanes.
 * The brick may turn a corner mid-drag once it lines up with a row or column.
 * Returns true if the brick started leaving through a gate.
 */
function dragToward(s: Session, d: Drag, tx: number, ty: number): boolean {
  for (let iter = 0; iter < 12; iter++) {
    const dx = tx - d.px;
    const dy = ty - d.py;
    if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return false;
    const fx = !whole(d.px);
    const fy = !whole(d.py);
    const wantH = Math.abs(dx) >= Math.abs(dy);
    // Corner assist: the finger wants the other axis and the brick is close to a lane.
    if (fx && !wantH && Math.abs(dy) > 0.2 && Math.abs(d.px - Math.round(d.px)) < 0.42) { d.px = Math.round(d.px); continue; }
    if (fy && wantH && Math.abs(dx) > 0.2 && Math.abs(d.py - Math.round(d.py)) < 0.42) { d.py = Math.round(d.py); continue; }
    const order: ('h' | 'v')[] = fx ? ['h'] : fy ? ['v'] : wantH ? ['h', 'v'] : ['v', 'h'];
    let progressed = false;
    for (const axis of order) {
      const delta = axis === 'h' ? dx : dy;
      if (Math.abs(delta) < EPS) continue;
      const pos = axis === 'h' ? d.px : d.py;
      const sign = delta > 0 ? 1 : -1;
      const dir: Dir = axis === 'h' ? (sign > 0 ? 1 : 3) : (sign > 0 ? 2 : 0);
      const base = sign > 0 ? Math.floor(pos + EPS) : Math.ceil(pos - EPS);
      const cx = axis === 'h' ? base : Math.round(d.px);
      const cy = axis === 'v' ? base : Math.round(d.py);
      const a = reach(s, d, cx, cy, dir);
      const travel = (pos + delta - base) * sign;
      if (a.exitAt && travel >= a.exitAt - 1 + 0.3) {
        const ex = axis === 'h' ? base + sign * (a.exitAt - 1) : cx;
        const ey = axis === 'v' ? base + sign * (a.exitAt - 1) : cy;
        const live = s.live[d.i];
        live.x = live.tx = d.px;
        live.y = live.ty = d.py;
        beginExit(s, d.i, dir, ex, ey, Math.abs(axis === 'h' ? d.vx : d.vy));
        return true;
      }
      const lim = a.exitAt ? a.exitAt - 1 + 0.3 : a.max;
      const next = base + sign * Math.min(Math.max(travel, 0), lim);
      if (Math.abs(next - pos) > EPS) {
        if (axis === 'h') d.px = next; else d.py = next;
        progressed = true;
        break;
      }
    }
    if (!progressed) return false;
  }
  return false;
}

/** Commit the drag: snap to the nearest cell, or glide on a flick. */
function releaseDrag(s: Session, d: Drag) {
  const live = s.live[d.i];
  const speedX = Math.abs(d.vx);
  const speedY = Math.abs(d.vy);
  const flickH = whole(d.py) && speedX > 7 && speedX > speedY;
  const flickV = whole(d.px) && speedY > 7 && speedY > speedX;
  let nx = Math.round(d.px);
  let ny = Math.round(d.py);
  if (flickH || flickV) {
    const sign = flickH ? Math.sign(d.vx) : Math.sign(d.vy);
    const dir: Dir = flickH ? (sign > 0 ? 1 : 3) : (sign > 0 ? 2 : 0);
    const pos = flickH ? d.px : d.py;
    const base = sign > 0 ? Math.floor(pos + EPS) : Math.ceil(pos - EPS);
    const cx = flickH ? base : nx;
    const cy = flickV ? base : ny;
    const a = reach(s, d, cx, cy, dir);
    if (a.exitAt) {
      const ex = flickH ? base + sign * (a.exitAt - 1) : cx;
      const ey = flickV ? base + sign * (a.exitAt - 1) : cy;
      live.tx = d.px;
      live.ty = d.py;
      beginExit(s, d.i, dir, ex, ey, flickH ? speedX : speedY);
      return;
    }
    nx = flickH ? base + sign * a.max : nx;
    ny = flickV ? base + sign * a.max : ny;
  }
  const changed = nx !== s.sim.x[d.i] || ny !== s.sim.y[d.i];
  s.sim.x[d.i] = nx;
  s.sim.y[d.i] = ny;
  live.tx = nx;
  live.ty = ny;
  if (changed) {
    const before = s.sim.color[d.i];
    settlePaint(s.level, s.sim, d.i);
    if (s.sim.color[d.i] !== before) {
      live.flash = 1;
      juice('unlock');
    } else {
      audio.play('tick');
      haptics.pulse(8);
    }
  }
}

function hitPiece(s: Session, px: number, py: number): number {
  const { cell, ox, oy } = s.geom;
  for (let i = s.level.pieces.length - 1; i >= 0; i--) {
    if (!pieceActive(s.level, s.sim, i)) continue;
    const live = s.live[i];
    for (const [dx, dy] of SHAPES[s.level.pieces[i].shape].cells) {
      const x = ox + (live.x + dx) * cell;
      const y = oy + (live.y + dy) * cell;
      if (px >= x && px < x + cell && py >= y && py < y + cell) return i;
    }
  }
  return -1;
}

function localPoint(ev: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

function cellPoint(s: Session, p: { x: number; y: number }) {
  return { x: (p.x - s.geom.ox) / s.geom.cell, y: (p.y - s.geom.oy) / s.geom.cell };
}

function onPointerDown(ev: PointerEvent) {
  if (mode !== 'play' || !session || session.over || session.exiting) return;
  audio.unlock();
  const s = session;
  const p = localPoint(ev);
  const i = hitPiece(s, p.x, p.y);
  if (i < 0) return;
  if (!canMove(s.level, s.sim, i)) {
    juice('bump');
    s.live[i].flash = 1;
    s.live[i].squash = 0.14;
    return;
  }
  const c = cellPoint(s, p);
  const px = s.sim.x[i];
  const py = s.sim.y[i];
  s.drag = { pre: capture(s), i, pid: ev.pointerId, gx: c.x - px, gy: c.y - py, px, py, occ: occupancy(s.level, s.sim), vx: 0, vy: 0, t: ev.timeStamp, moved: false };
  s.live[i].lift = 4;
  canvas.setPointerCapture(ev.pointerId);
  audio.play('grab');
  haptics.pulse(8);
}

function onPointerMove(ev: PointerEvent) {
  const s = session;
  if (!s || mode !== 'play') return;
  const p = localPoint(ev);
  if (!s.drag) {
    const hit = hitPiece(s, p.x, p.y);
    s.frame.hoverId = hit;
    canvas.style.cursor = hit >= 0 ? 'grab' : 'default';
    return;
  }
  const d = s.drag;
  if (d.pid !== ev.pointerId || s.exiting) return;
  s.frame.hoverId = d.i;
  canvas.style.cursor = 'grabbing';
  // Coalesced events give every sample the browser saw, so fast swipes don't skip past walls.
  const events = ev.getCoalescedEvents?.() ?? [];
  const samples = events.length ? events : [ev];
  for (const e of samples) {
    const c = cellPoint(s, localPoint(e));
    const bx = d.px;
    const by = d.py;
    if (dragToward(s, d, c.x - d.gx, c.y - d.gy)) return;
    const dt = Math.max(1, e.timeStamp - d.t) / 1000;
    d.t = e.timeStamp;
    // Smoothed velocity in cells per second, for flicks.
    const k = Math.min(1, dt / 0.05);
    d.vx += ((d.px - bx) / dt - d.vx) * k;
    d.vy += ((d.py - by) / dt - d.vy) * k;
    if (Math.abs(d.px - s.sim.x[d.i]) > 0.05 || Math.abs(d.py - s.sim.y[d.i]) > 0.05) d.moved = true;
  }
  const live = s.live[d.i];
  live.tx = d.px;
  live.ty = d.py;
}

function onPointerUp(ev: PointerEvent) {
  const s = session;
  if (!s?.drag || s.drag.pid !== ev.pointerId) return;
  const d = s.drag;
  s.drag = null;
  canvas.style.cursor = 'default';
  if (s.exiting) return;
  // A stale velocity from an earlier stop should not count as a flick.
  if (ev.timeStamp - d.t > 60) { d.vx = 0; d.vy = 0; }
  releaseDrag(s, d);
  // A flick may have started an exit (recorded there); otherwise count a drag that moved.
  if (!s.exiting && (s.sim.x[d.i] !== d.pre.x[d.i] || s.sim.y[d.i] !== d.pre.y[d.i])) record(s, d.pre);
}

function capture(s: Session): Undo {
  const m = s.sim;
  return { x: m.x.slice(), y: m.y.slice(), out: m.out.slice(), color: m.color.slice(), passed: m.passed.slice(), clears: m.clears, keys: m.keys, moves: s.moves };
}

function record(s: Session, pre: Undo) {
  s.history.push(pre);
  if (s.history.length > 200) s.history.shift();
  s.moves++;
  paintHud();
}

/** Step back one drag. Also climbs out of a dead end. */
function undo() {
  const s = session;
  if (!s || s.exiting || s.drag || !s.history.length) return;
  if (s.over && !s.stuck) return;
  const u = s.history.pop()!;
  const m = s.sim;
  m.x.set(u.x);
  m.y.set(u.y);
  m.out.set(u.out);
  m.color.set(u.color);
  m.passed.set(u.passed);
  m.clears = u.clears;
  m.keys = u.keys;
  s.moves = u.moves;
  s.live.forEach((live, i) => {
    // A brick that had left reappears in place rather than flying back from the gate.
    if (live.out && !m.out[i]) {
      live.x = m.x[i];
      live.y = m.y[i];
      live.flash = 1;
    }
    live.out = !!m.out[i];
    live.tx = m.x[i];
    live.ty = m.y[i];
  });
  s.frame.clears = m.clears;
  s.frame.keys = m.keys;
  if (s.over) {
    s.over = false;
    s.stuck = false;
    mode = 'play';
    renderChrome();
  }
  audio.play('tick');
  paintHud();
}

function snapshotOf(s: Session): Snapshot {
  return {
    n: s.level.n,
    x: Array.from(s.sim.x),
    y: Array.from(s.sim.y),
    out: Array.from(s.sim.out),
    timeLeft: s.timeLeft,
    freeze: s.freeze,
    boosters: s.boosters,
    color: Array.from(s.sim.color),
    passed: Array.from(s.sim.passed),
    moves: s.moves,
  };
}

function persistProgress() {
  if (mode === 'play' && session && !session.over) save.snapshot = snapshotOf(session);
  write(save);
}

function onWin() {
  const s = session;
  if (!s || s.over) return;
  s.over = true;
  const untimed = !save.settings.timer;
  const star = stars(s.moves, s.level.metrics.par);
  const firstClear = !save.best[String(s.level.n)];
  s.gained = firstClear ? winCoins(s.level.n, s.level.label, s.timeLeft, untimed) : 15;
  save.coins += s.gained;
  save.unlocked = Math.max(save.unlocked, s.level.n + 1);
  const prev = save.best[String(s.level.n)];
  const time = untimed ? (prev?.time ?? s.level.timer) : s.level.timer - s.timeLeft;
  if (!prev || star > prev.stars || (!untimed && star === prev.stars && time < prev.time)) {
    save.best[String(s.level.n)] = { time, stars: star };
  }
  save.snapshot = null;
  write(save);
  juice('win');
  mode = 'win';
  renderChrome();
}

function onFail() {
  const s = session;
  if (!s || s.over) return;
  s.over = true;
  save.snapshot = null;
  write(save);
  juice('fail');
  mode = 'fail';
  renderChrome();
}

function clockText(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderChrome() {
  const playing = mode === 'play' || mode === 'pause';
  hud.classList.toggle('hidden', !playing);
  document.querySelector('#btn-undo')!.classList.toggle('hidden', mode !== 'play');
  screens.innerHTML = '';
  if (mode === 'title') screens.append(titleScreen());
  else if (mode === 'levels') screens.append(levelScreen());
  else if (mode === 'help') screens.append(helpScreen());
  else if (mode === 'settings') screens.append(settingsScreen());
  else if (mode === 'pause') screens.append(pauseScreen());
  else if (mode === 'win' && session) screens.append(resultScreen(true));
  else if (mode === 'fail' && session) screens.append(resultScreen(false));
  hintEl.classList.toggle('hidden', mode !== 'play' || !session || session.hintFor <= 0);
  paintHud();
}

function paintHud() {
  const s = session;
  if (!s) return;
  document.querySelector('#hud-level')!.textContent = `Lv ${s.level.n}`;
  const par = s.level.metrics.par;
  const moves = document.querySelector<HTMLElement>('#hud-moves')!;
  moves.textContent = par ? `${s.moves} / par ${par}` : `${s.moves} moves`;
  moves.classList.toggle('over', !!par && s.moves > par);
  document.querySelector<HTMLButtonElement>('#btn-undo')!.disabled = !s.history.length;
  document.querySelector('#hud-label')!.textContent = s.level.label === 'Normal' ? '' : `${s.level.label} level`;
  const time = document.querySelector<HTMLElement>('#hud-time')!;
  const timed = save.settings.timer;
  time.classList.toggle('hidden', !timed);
  time.textContent = clockText(s.timeLeft);
  time.classList.toggle('danger', timed && s.freeze <= 0 && s.timeLeft <= 10);
  time.classList.toggle('warn', timed && s.freeze <= 0 && s.timeLeft <= 20 && s.timeLeft > 10);
  time.style.color = timed && s.freeze > 0 ? '#8ee7ff' : '';
}

function el(html: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild as HTMLElement;
}

function titleScreen() {
  const n = save.snapshot?.n ?? save.unlocked;
  const path = [n - 2, n - 1, n, n + 1, n + 2].filter((i) => i >= 1).map((i) => {
    const openLevel = i <= save.unlocked;
    return `<button class="node${i === n ? ' now' : ''}" data-n="${i}" ${openLevel ? '' : 'disabled'}>${i}</button>`;
  }).join('<span class="path-line"></span>');
  const node = el(`<div class="screen solid home">
    <div class="home-top">
      <div class="coin-pill">${save.coins}</div>
      <button class="icon gear" data-go="settings" aria-label="Settings">⚙</button>
    </div>
    <div class="home-hero">
      <div class="mark" aria-hidden="true"></div>
      <h1 class="wordmark">Block Out</h1>
      <p class="sub">Slide every brick through its gate.</p>
    </div>
    <div class="path">${path}</div>
    <button class="btn play" data-go="play">${save.snapshot ? 'Continue' : 'Play'}<em>Level ${n}</em></button>
    <div class="home-links">
      <button data-go="levels">All levels</button>
      <button data-go="help">How to play</button>
    </div>
    <div class="version" id="version">${VERSION_LABEL}</div>
  </div>`);
  node.querySelector('[data-go="play"]')!.addEventListener('click', () => {
    audio.unlock();
    audio.play('ui');
    if (save.snapshot) startLevel(save.snapshot.n, true);
    else startLevel(save.unlocked);
  });
  node.querySelectorAll<HTMLButtonElement>('.node').forEach((btn) => {
    btn.addEventListener('click', () => {
      const level = Number(btn.dataset.n);
      if (level <= save.unlocked) startLevel(level);
    });
  });
  node.querySelector('[data-go="levels"]')!.addEventListener('click', () => { chapter = Math.floor((save.unlocked - 1) / 20); open('levels'); });
  node.querySelector('[data-go="help"]')!.addEventListener('click', () => open('help'));
  node.querySelector('[data-go="settings"]')!.addEventListener('click', () => open('settings', 'title'));
  return node;
}

function levelScreen() {
  const start = chapter * 20 + 1;
  const buttons = Array.from({ length: 20 }, (_, k) => {
    const n = start + k;
    const openLevel = n <= save.unlocked;
    const best = save.best[String(n)];
    const starsTxt = best ? '★'.repeat(best.stars) + '☆'.repeat(3 - best.stars) : '';
    // Locked levels stay tappable: tapping one offers to skip ahead to it.
    return `<button class="lvl${openLevel ? '' : ' locked'}" data-n="${n}">${n}<small>${openLevel ? starsTxt : '🔒'}</small></button>`;
  }).join('');
  const node = el(`<div class="screen solid"><div class="card panel">
    <h1 class="sheet-title">Levels</h1>
    <div class="grid">${buttons}</div>
    <div class="row">
      <button class="btn ghost" data-go="prev" ${chapter === 0 ? 'disabled' : ''}>Back</button>
      <button class="btn ghost" data-go="next">Next</button>
    </div>
    <button class="btn" data-go="title" style="margin-top:10px">Home</button>
  </div></div>`);
  node.querySelectorAll<HTMLButtonElement>('.lvl').forEach((btn) => {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.n);
      if (n <= save.unlocked) startLevel(n);
      else node.append(skipSheet(n));
    });
  });
  node.querySelector('[data-go="prev"]')!.addEventListener('click', () => { chapter = Math.max(0, chapter - 1); renderChrome(); });
  node.querySelector('[data-go="next"]')!.addEventListener('click', () => { chapter += 1; renderChrome(); });
  node.querySelector('[data-go="title"]')!.addEventListener('click', () => open('title'));
  return node;
}

/** Confirm skipping ahead. Unlocks every level up to n; skipped ones stay playable. */
function skipSheet(n: number) {
  const sheet = el(`<div class="screen"><div class="card panel">
    <p class="eyebrow">Level ${n}</p>
    <h1 class="sheet-title">Skip ahead?</h1>
    <p class="sub">This unlocks every level up to ${n}. You can still go back and play the ones you skipped.</p>
    <div class="stack">
      <button class="btn gold" data-go="skip">Unlock and play</button>
      <button class="btn ghost" data-go="cancel">Cancel</button>
    </div>
  </div></div>`);
  sheet.querySelector('[data-go="skip"]')!.addEventListener('click', () => {
    save.unlocked = Math.max(save.unlocked, n);
    write(save);
    audio.play('ui');
    startLevel(n);
  });
  sheet.querySelector('[data-go="cancel"]')!.addEventListener('click', () => sheet.remove());
  return sheet;
}

function helpScreen() {
  const node = el(`<div class="screen solid"><div class="card panel">
    <h1 class="sheet-title">How to play</h1>
    <div class="help">
      <p><b>Drag</b> a brick along a row or column, around corners too. It stops when it hits something.</p>
      <p>Line it up with a <b>gate of its color</b> that is as wide as the brick or wider, and drag it out.</p>
      <p><b>Ice</b> (blue, with a snowflake) thaws after that many bricks have left. Frozen gates work the same way.</p>
      <p>A brick with a <b>key</b> unlocks <b>padlocked</b> bricks when it leaves. The padlock shows how many keys it still needs.</p>
      <p><b>Arrows</b> on a brick mean it only slides that way. <b>Dots</b> on a gate count how many more bricks it lets through, so spend them on the right bricks. <b>Trap</b> levels hide an easy exit that strands another brick. A brick that stops on a <b>paint</b> splash turns that color. Two different paints under it cancel out. A <b>shutter</b> lifts when its count reaches zero.</p>
      <p>Clear the tray before the clock runs out, or turn <b>Timer</b> off in Settings. Finish within <b>par</b>, the fewest drags we found, for three stars. <b>Undo</b> steps back one drag, even out of a dead end.</p>
    </div>
    <button class="btn" data-go="title">Back</button>
  </div></div>`);
  node.querySelector('[data-go="title"]')!.addEventListener('click', () => open('title'));
  return node;
}

function settingRow(key: keyof Settings, label: string) {
  return `<label class="toggle">${label}<input type="checkbox" data-set="${key}" ${save.settings[key] ? 'checked' : ''} /></label>`;
}

function bindSettings(root: ParentNode) {
  root.querySelectorAll<HTMLInputElement>('input[data-set]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.set as keyof Settings;
      save.settings[key] = input.checked;
      audio.enabled = save.settings.sound;
      haptics.enabled = save.settings.haptics;
      if (session) {
        session.frame.symbols = save.settings.symbols;
        session.frame.reduce = save.settings.reduceMotion;
      }
      write(save);
      paintHud();
    });
  });
}

function settingsScreen() {
  const node = el(`<div class="screen solid"><div class="card panel" style="text-align:left">
    <h1 class="sheet-title">Settings</h1>
    ${settingRow('timer', 'Timer')}
    <p class="note">Off: no countdown and no time-out. The tray can still be cleared.</p>
    ${settingRow('sound', 'Sound')}
    ${settingRow('haptics', 'Haptics')}
    ${settingRow('reduceMotion', 'Reduce motion')}
    ${settingRow('symbols', 'Color symbols')}
    <button class="btn ghost" data-go="update" style="margin-top:16px;width:100%">Update now</button>
    <p class="note" style="text-align:center">${VERSION_LABEL}</p>
    <button class="btn" data-go="back" style="margin-top:8px;width:100%">Back</button>
  </div></div>`);
  bindSettings(node);
  const upd = node.querySelector<HTMLButtonElement>('[data-go="update"]')!;
  upd.addEventListener('click', () => {
    write(save);
    upd.disabled = true;
    upd.textContent = 'Updating…';
    void forceUpdate();
  });
  node.querySelector('[data-go="back"]')!.addEventListener('click', () => open(settingsBack));
  return node;
}

function pauseScreen() {
  const node = el(`<div class="screen"><div class="card panel">
    <h1 class="sheet-title">Paused</h1>
    ${settingRow('timer', 'Timer')}
    <p class="note">Turn this off to drop the clock for the rest of your puzzles.</p>
    <div class="stack">
      <button class="btn" data-go="resume">Resume</button>
      <button class="btn ghost" data-go="settings">Settings</button>
      <button class="btn ghost" data-go="retry">Retry</button>
      <button class="btn ghost" data-go="levels">Levels</button>
      <button class="btn ghost" data-go="title">Home</button>
    </div>
  </div></div>`);
  bindSettings(node);
  node.querySelector('[data-go="settings"]')!.addEventListener('click', () => open('settings', 'pause'));
  node.querySelector('[data-go="resume"]')!.addEventListener('click', () => { mode = 'play'; renderChrome(); });
  node.querySelector('[data-go="retry"]')!.addEventListener('click', () => session && startLevel(session.level.n));
  node.querySelector('[data-go="levels"]')!.addEventListener('click', () => { persistProgress(); open('levels'); });
  node.querySelector('[data-go="title"]')!.addEventListener('click', () => { persistProgress(); open('title'); });
  return node;
}

function resultScreen(win: boolean) {
  const s = session!;
  const star = win ? stars(s.moves, s.level.metrics.par) : 0;
  const gained = win ? s.gained : 0;
  const starHtml = [0, 1, 2].map((i) => `<span class="star${i < star ? ' on' : ''}" style="animation-delay:${0.18 + i * 0.18}s">★</span>`).join('');
  const node = el(`<div class="screen ${win ? 'win' : 'fail'}"><div class="card panel">
    <p class="eyebrow">Level ${s.level.n}</p>
    <h1 class="sheet-title">${win ? 'Clear' : s.stuck ? 'Dead end' : "Time's up"}</h1>
    ${win ? `<div class="stars" aria-label="${star} stars">${starHtml}</div><p class="sub">${s.moves} moves · par ${s.level.metrics.par ?? s.moves}</p><p class="gain" id="gain">+0</p><p class="purse">Balance <b id="purse">${save.coins - gained}</b></p>` : s.stuck ? '<p class="sub">That exit used up a gate another brick needed. It was a trap.</p>' : '<p class="sub">The tray is still full. Take another run.</p>'}
    <div class="stack">
      ${win ? `<button class="btn gold next" data-go="next">Next · Level ${s.level.n + 1}</button>` : ''}
      ${!win && s.stuck ? '<button class="btn gold" data-go="undo">Undo last move</button>' : ''}
      <button class="btn${win ? ' ghost' : ''}" data-go="retry">Retry</button>
      <button class="btn ghost" data-go="levels">Levels</button>
    </div>
  </div></div>`);
  if (win) tickGain(node.querySelector('#gain')!, node.querySelector('#purse')!, save.coins - gained, gained);
  node.querySelector('[data-go="next"]')?.addEventListener('click', () => startLevel(s.level.n + 1));
  node.querySelector('[data-go="undo"]')?.addEventListener('click', () => undo());
  node.querySelector('[data-go="retry"]')!.addEventListener('click', () => startLevel(s.level.n));
  node.querySelector('[data-go="levels"]')!.addEventListener('click', () => open('levels'));
  return node;
}

function tickGain(gain: HTMLElement, purse: HTMLElement, start: number, amount: number) {
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / 720);
    const eased = 1 - (1 - k) ** 3;
    const shown = Math.round(amount * eased);
    gain.textContent = `+${shown}`;
    purse.textContent = String(start + shown);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function open(next: Mode, back?: Mode) {
  if (back) settingsBack = back;
  audio.play('ui');
  mode = next;
  renderChrome();
}

document.querySelector('#btn-undo')!.addEventListener('click', () => undo());
document.addEventListener('keydown', (e) => {
  if ((e.key === 'z' && (e.metaKey || e.ctrlKey)) || e.key === 'u') undo();
});
document.querySelector('#btn-pause')!.addEventListener('click', () => {
  if (mode !== 'play') return;
  persistProgress();
  mode = 'pause';
  renderChrome();
});

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
window.addEventListener('resize', resize);
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && mode === 'play') {
    persistProgress();
    mode = 'pause';
    renderChrome();
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) persistProgress(); });

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = session;
  if (s && mode === 'play' && !s.over) {
    s.frame.time += dt;
    s.hintFor -= dt;
    if (s.hintFor <= 0) hintEl.classList.add('hidden');
    // Frame-rate independent easing toward each brick's target cell.
    const follow = 1 - Math.exp(-dt * 38);
    const settle = 1 - Math.exp(-dt * 22);
    s.live.forEach((live, i) => {
      if (s.exiting?.i !== i) {
        const k = s.drag?.i === i ? follow : settle;
        live.x += (live.tx - live.x) * k;
        live.y += (live.ty - live.y) * k;
        if (Math.abs(live.tx - live.x) < 0.002) live.x = live.tx;
        if (Math.abs(live.ty - live.y) < 0.002) live.y = live.ty;
      }
      if (live.lift > 0 && s.drag?.i !== i) live.lift = Math.max(0, live.lift - dt * 30);
      live.flash = Math.max(0, live.flash - dt * 2.4);
      live.squash *= Math.exp(-dt * 7);
      if (live.squash < 0.004) live.squash = 0;
    });
    const clock = tickClock(s.timeLeft, s.freeze, dt, save.settings.timer);
    s.timeLeft = clock.timeLeft;
    s.freeze = clock.freeze;
    if (s.exiting) {
      const ex = s.exiting;
      ex.t += dt / ex.dur;
      const k = Math.min(1, ex.t);
      // Slight ease-in: the brick accelerates into the gate.
      const ease = k * (0.6 + 0.4 * k);
      s.live[ex.i].x = ex.x + DX[ex.dir] * ease * ex.dist;
      s.live[ex.i].y = ex.y + DY[ex.dir] * ease * ex.dist;
      const shape = SHAPES[s.level.pieces[ex.i].shape];
      const span = ex.dir === 0 || ex.dir === 2 ? shape.h : shape.w;
      sprayVoxels(s, ex, Math.max(0, Math.min(1, (ease * ex.dist - ex.toEdge) / span)));
      if (k >= 1) {
        finishExit(s, ex.i);
        s.frame.exitId = -1;
      }
    }
    if (clock.failed && !s.over) onFail();
    for (const f of s.frame.flights) f.t += dt / 0.7;
    s.frame.flights = s.frame.flights.filter((f) => f.t < 1);
    stepFx(s.frame, dt);
    if (Math.floor(s.frame.time) !== Math.floor(s.frame.time - dt)) persistProgress();
  }
  // Let the last brick's debris finish falling behind the result screen.
  else if (s?.over && s.frame.particles.length) stepFx(s.frame, dt);
  if (s) {
    s.frame.dragId = s.drag?.i ?? -1;
    s.frame.symbols = save.settings.symbols;
    s.frame.reduce = save.settings.reduceMotion;
    render(ctx, s.geom, s.frame);
    if (mode === 'play') paintHud();
  } else {
    ctx.fillStyle = '#141833';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  }
  requestAnimationFrame(loop);
}

resize();
renderChrome();
requestAnimationFrame(loop);

declare global {
  interface Window { __blockout?: unknown; }
}
window.__blockout = {
  start: (n: number) => startLevel(n),
  mode: () => mode,
  session: () => session,
  save: () => save,
  geom: () => session?.geom ?? null,
  /** Test hook: clear the open tray and show the win screen. */
  clear: () => {
    const s = session;
    if (!s || s.over) return;
    for (let i = 0; i < s.level.pieces.length; i++) {
      if (s.sim.out[i]) continue;
      s.sim.out[i] = 1;
      s.sim.clears += 1;
      s.sim.keys += s.level.pieces[i].keys;
      s.live[i].out = true;
    }
    s.frame.clears = s.sim.clears;
    s.frame.keys = s.sim.keys;
    onWin();
  },
};

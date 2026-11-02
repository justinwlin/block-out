import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { destroyColor, destroyPiece } from './sim/boosters';
import { CLOCK_SECONDS, PRICES, stars, tickClock, winCoins } from './sim/economy';
import { feedback } from './sim/feel';
import { generateLevel } from './sim/levelgen';
import { applyMove, analyze, canMove, makeState, occupancy, pieceActive, won } from './sim/rules';
import { SHAPES } from './sim/shapes';
import { DX, DY, type Dir, type Level, type SimState } from './sim/types';
import { AudioBus } from './game/audio';
import { Haptics } from './game/haptics';
import { burst, geomFor, paintColor, render, stepFx, type Floater, type Frame, type Geom, type Particle } from './game/render';
import { load, write, type Save, type Settings, type Snapshot } from './game/save';

registerSW({ immediate: true });

type Mode = 'title' | 'levels' | 'play' | 'pause' | 'win' | 'fail' | 'help' | 'settings';
type Boost = 'clock' | 'rocket' | 'ufo';

interface Live {
  x: number;
  y: number;
  out: boolean;
  lift: number;
}
interface ExitAnim {
  i: number;
  dir: Dir;
  t: number;
  x: number;
  y: number;
}
interface Drag {
  i: number;
  pid: number;
  sx: number;
  sy: number;
  axis: 'h' | 'v' | null;
  off: number;
}
interface Session {
  level: Level;
  sim: SimState;
  live: Live[];
  timeLeft: number;
  freeze: number;
  boosters: number;
  target: Boost | null;
  drag: Drag | null;
  exiting: ExitAnim | null;
  over: boolean;
  geom: Geom;
  frame: Frame;
  hintFor: number;
  gained: number;
}

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const ctx = canvas.getContext('2d')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const bar = document.querySelector<HTMLElement>('#bar')!;
const screens = document.querySelector<HTMLElement>('#screens')!;
const hintEl = document.querySelector<HTMLElement>('#hint')!;
const targetEl = document.querySelector<HTMLElement>('#target-banner')!;
const toastEl = document.querySelector<HTMLElement>('#toast')!;
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
let toastTimer = 0;

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

function freshFrame(level: Level, live: Live[]): Frame {
  return {
    level,
    pieces: live,
    clears: 0,
    keys: 0,
    shake: 0,
    particles: [] as Particle[],
    texts: [] as Floater[],
    dragId: -1,
    symbols: save.settings.symbols,
    reduce: save.settings.reduceMotion,
    time: 0,
  };
}

function startLevel(n: number, resume = false) {
  const level = generateLevel(n);
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
  }
  const live = level.pieces.map((_, i) => ({ x: sim.x[i], y: sim.y[i], out: !!sim.out[i], lift: 0 }));
  session = {
    level,
    sim,
    live,
    timeLeft: snap && snap.n === n ? snap.timeLeft : level.timer,
    freeze: snap && snap.n === n ? snap.freeze : 0,
    boosters: snap && snap.n === n ? snap.boosters : 0,
    target: null,
    drag: null,
    exiting: null,
    over: false,
    geom: geomFor(1, 1, 1, 1, 0, 0),
    frame: freshFrame(level, live),
    hintFor: 2.6,
    gained: 0,
  };
  session.frame.clears = sim.clears;
  session.frame.keys = sim.keys;
  fit(session);
  mode = 'play';
  hintEl.textContent = level.hint;
  renderChrome();
}

function syncLive(s: Session) {
  for (let i = 0; i < s.live.length; i++) {
    if (s.exiting?.i === i || s.drag?.i === i) continue;
    s.live[i].x = s.sim.x[i];
    s.live[i].y = s.sim.y[i];
    s.live[i].out = !!s.sim.out[i];
    s.live[i].lift = 0;
  }
}

function juice(kind: string, x?: number, y?: number) {
  const feel = feedback(kind, save.settings.reduceMotion);
  if (session) {
    session.frame.shake = Math.min(14, session.frame.shake + feel.shake);
    if (feel.particles && x !== undefined && y !== undefined) {
      const color = '#fff';
      burst(session.frame.particles, x, y, color, feel.particles);
    }
  }
  haptics.pulse(feel.haptic);
  audio.play(kind as 'exit');
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
      juice('thaw', c.x, c.y);
      s.frame.texts.push({ x: c.x, y: c.y, life: 0.8, text: 'Thaw', color: '#e7f7ff' });
    }
    if (p.lock > 0 && beforeKeys < p.lock && sim.keys >= p.lock) {
      const c = pieceCenter(s, i);
      juice('unlock', c.x, c.y);
    }
  }
  for (let r = 0; r < level.rooms.length; r++) {
    const room = level.rooms[r];
    if (beforeClears < room.openAfter && sim.clears >= room.openAfter) {
      const x = s.geom.ox + (room.x + room.w / 2) * s.geom.cell;
      const y = s.geom.oy + (room.y + room.h / 2) * s.geom.cell;
      juice('room', x, y);
      burst(s.frame.particles, x, y, '#ffd56a', 16);
    }
  }
}

function finishExit(s: Session, i: number) {
  const beforeC = s.sim.clears;
  const beforeK = s.sim.keys;
  const c = pieceCenter(s, i);
  const col = paintColor(s.level, s.level.pieces[i].color);
  applyMove(s.level, s.sim, { i, dir: 0, dist: 1, exit: true });
  s.live[i].out = true;
  s.frame.clears = s.sim.clears;
  s.frame.keys = s.sim.keys;
  burst(s.frame.particles, c.x, c.y, col.hex, feedback('exit', false).particles);
  juice('exit', c.x, c.y);
  noteChanges(s, beforeC, beforeK);
  s.exiting = null;
  if (won(s.level, s.sim)) onWin();
}

function beginExit(s: Session, i: number, dir: Dir) {
  if (s.exiting || s.over) return;
  const live = s.live[i];
  s.drag = null;
  s.exiting = { i, dir, t: 0, x: live.x, y: live.y };
}

function slideBy(s: Session, i: number, dir: Dir, dist: number) {
  if (dist < 1) return;
  const a = analyze(s.level, s.sim, occupancy(s.level, s.sim), i, dir);
  if (a.exitAt && dist >= a.exitAt) {
    beginExit(s, i, dir);
    return;
  }
  const use = Math.min(dist, a.max);
  if (use < 1) {
    juice('bump');
    return;
  }
  applyMove(s.level, s.sim, { i, dir, dist: use, exit: false });
  syncLive(s);
  audio.play('tick');
  haptics.pulse(8);
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

function spend(kind: Boost): boolean {
  if (!session) return false;
  const price = PRICES[kind];
  if (save.coins < price) {
    showToast(`Need ${price} coins`);
    juice('bump');
    return false;
  }
  save.coins -= price;
  session.boosters++;
  write(save);
  return true;
}

function useClock() {
  if (!session || session.over || !save.settings.timer) return;
  if (session.freeze > 0) return;
  if (!spend('clock')) return;
  session.freeze = CLOCK_SECONDS;
  juice('clock');
  showToast('Clock stopped');
}

function arm(kind: 'rocket' | 'ufo') {
  if (!session || session.over) return;
  if (session.target === kind) {
    session.target = null;
    return;
  }
  if (save.coins < PRICES[kind]) {
    showToast(`Need ${PRICES[kind]} coins`);
    juice('bump');
    return;
  }
  session.target = kind;
  audio.play('ui');
}

function fireAt(i: number) {
  const s = session;
  if (!s || !s.target || s.over) return;
  if (!pieceActive(s.level, s.sim, i)) {
    juice('bump');
    return;
  }
  const kind = s.target;
  if (!spend(kind)) return;
  const beforeC = s.sim.clears;
  const beforeK = s.sim.keys;
  const col = paintColor(s.level, s.level.pieces[i].color);
  if (kind === 'rocket') {
    const c = pieceCenter(s, i);
    destroyPiece(s.level, s.sim, i);
    s.live[i].out = true;
    burst(s.frame.particles, c.x, c.y, col.hex, 18);
    juice('rocket', c.x, c.y);
  } else {
    const color = s.level.pieces[i].color;
    for (let k = 0; k < s.level.pieces.length; k++) {
      if (s.level.pieces[k].color !== color || !pieceActive(s.level, s.sim, k)) continue;
      const c = pieceCenter(s, k);
      burst(s.frame.particles, c.x, c.y, col.hex, 8);
      s.live[k].out = true;
    }
    destroyColor(s.level, s.sim, color);
    juice('ufo');
  }
  s.frame.clears = s.sim.clears;
  s.frame.keys = s.sim.keys;
  s.target = null;
  noteChanges(s, beforeC, beforeK);
  if (won(s.level, s.sim)) onWin();
}

function onPointerDown(ev: PointerEvent) {
  if (mode !== 'play' || !session || session.over || session.exiting) return;
  audio.unlock();
  const s = session;
  const p = localPoint(ev);
  const i = hitPiece(s, p.x, p.y);
  if (i < 0) return;
  if (s.target) {
    fireAt(i);
    return;
  }
  if (!canMove(s.level, s.sim, i)) {
    juice('bump');
    s.live[i].lift = 2;
    return;
  }
  s.drag = { i, pid: ev.pointerId, sx: p.x, sy: p.y, axis: null, off: 0 };
  canvas.setPointerCapture(ev.pointerId);
  audio.play('grab');
  haptics.pulse(8);
}

function onPointerMove(ev: PointerEvent) {
  const s = session;
  if (!s?.drag || s.drag.pid !== ev.pointerId || s.exiting) return;
  const p = localPoint(ev);
  const dx = p.x - s.drag.sx;
  const dy = p.y - s.drag.sy;
  if (!s.drag.axis && Math.hypot(dx, dy) > 8) s.drag.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
  if (!s.drag.axis) return;
  const delta = (s.drag.axis === 'h' ? dx : dy) / s.geom.cell;
  const dir: Dir = s.drag.axis === 'h' ? (delta >= 0 ? 1 : 3) : (delta >= 0 ? 2 : 0);
  const a = analyze(s.level, s.sim, occupancy(s.level, s.sim), s.drag.i, dir);
  const limit = a.exitAt || a.max;
  const mag = Math.min(Math.abs(delta), limit);
  s.drag.off = Math.sign(delta || 1) * mag;
  const live = s.live[s.drag.i];
  live.x = s.sim.x[s.drag.i] + (s.drag.axis === 'h' ? s.drag.off : 0);
  live.y = s.sim.y[s.drag.i] + (s.drag.axis === 'v' ? s.drag.off : 0);
  live.lift = 6;
  if (a.exitAt && Math.abs(s.drag.off) >= a.exitAt - 0.12) beginExit(s, s.drag.i, dir);
}

function onPointerUp(ev: PointerEvent) {
  const s = session;
  if (!s?.drag || s.drag.pid !== ev.pointerId) return;
  const drag = s.drag;
  s.drag = null;
  if (s.exiting) return;
  if (!drag.axis) {
    syncLive(s);
    return;
  }
  const dir: Dir = drag.axis === 'h' ? (drag.off >= 0 ? 1 : 3) : (drag.off >= 0 ? 2 : 0);
  const dist = Math.abs(Math.round(drag.off));
  if (dist < 1) syncLive(s);
  else slideBy(s, drag.i, dir, dist);
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
  s.target = null;
  const untimed = !save.settings.timer;
  const star = stars(s.level.timer, s.timeLeft, s.boosters, untimed);
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
  bar.classList.toggle('hidden', !playing);
  screens.innerHTML = '';
  if (mode === 'title') screens.append(titleScreen());
  else if (mode === 'levels') screens.append(levelScreen());
  else if (mode === 'help') screens.append(helpScreen());
  else if (mode === 'settings') screens.append(settingsScreen());
  else if (mode === 'pause') screens.append(pauseScreen());
  else if (mode === 'win' && session) screens.append(resultScreen(true));
  else if (mode === 'fail' && session) screens.append(resultScreen(false));
  hintEl.classList.toggle('hidden', mode !== 'play' || !session || session.hintFor <= 0);
  targetEl.classList.toggle('hidden', !(mode === 'play' && session?.target));
  if (session?.target === 'rocket') targetEl.textContent = 'Tap a brick to rocket';
  if (session?.target === 'ufo') targetEl.textContent = 'Tap a brick — every brick of that color goes';
  paintHud();
}

function paintHud() {
  const s = session;
  if (!s) return;
  document.querySelector('#hud-level')!.textContent = `Level ${s.level.n}`;
  document.querySelector('#hud-label')!.textContent = s.level.label === 'Normal' ? '' : s.level.label;
  const time = document.querySelector<HTMLElement>('#hud-time')!;
  const timed = save.settings.timer;
  time.classList.toggle('hidden', !timed);
  time.textContent = clockText(s.timeLeft);
  time.classList.toggle('danger', timed && s.freeze <= 0 && s.timeLeft <= 10);
  time.classList.toggle('warn', timed && s.freeze <= 0 && s.timeLeft <= 20 && s.timeLeft > 10);
  time.style.color = timed && s.freeze > 0 ? '#8ee7ff' : '';
  document.querySelector('#hud-coins')!.textContent = String(save.coins);
  document.querySelector('#boost-clock')!.classList.toggle('hidden', !timed);
  for (const kind of ['clock', 'rocket', 'ufo'] as const) {
    const btn = document.querySelector<HTMLButtonElement>(`#boost-${kind}`)!;
    btn.classList.toggle('on', s.target === kind);
    btn.disabled = save.coins < PRICES[kind] && s.target !== kind;
  }
}

function el(html: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild as HTMLElement;
}

function titleScreen() {
  const node = el(`<div class="screen solid"><div class="card">
    <h1>Block<br>Out</h1>
    <p class="sub">Slide every brick out through its gate.</p>
    <div class="stack">
      <button class="btn" data-go="play">${save.snapshot ? 'Continue' : 'Play'}</button>
      <button class="btn ghost" data-go="levels">Levels</button>
      <button class="btn ghost" data-go="help">How to play</button>
      <button class="btn ghost" data-go="settings">Settings</button>
    </div>
    <p class="meta">● ${save.coins} · level ${save.unlocked}</p>
  </div></div>`);
  node.querySelector('[data-go="play"]')!.addEventListener('click', () => {
    audio.unlock();
    audio.play('ui');
    if (save.snapshot) startLevel(save.snapshot.n, true);
    else startLevel(save.unlocked);
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
    return `<button class="lvl" data-n="${n}" ${openLevel ? '' : 'disabled'}>${n}<small>${starsTxt}</small></button>`;
  }).join('');
  const node = el(`<div class="screen solid"><div class="card">
    <h1 style="font-size:36px">Levels</h1>
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
    });
  });
  node.querySelector('[data-go="prev"]')!.addEventListener('click', () => { chapter = Math.max(0, chapter - 1); renderChrome(); });
  node.querySelector('[data-go="next"]')!.addEventListener('click', () => { chapter += 1; renderChrome(); });
  node.querySelector('[data-go="title"]')!.addEventListener('click', () => open('title'));
  return node;
}

function helpScreen() {
  const node = el(`<div class="screen solid"><div class="card">
    <h1 style="font-size:36px">How to play</h1>
    <div class="help">
      <p><b>Drag</b> a brick along a row or a column. It stops when it hits something.</p>
      <p>Line it up with a <b>gate of its color</b> that it fits, and drag it out.</p>
      <p><b>Ice</b> and <b>padlocks</b> wait until enough bricks (or keys) have left. A <b>shutter</b> lifts when its count hits zero and reveals more bricks.</p>
      <p>Clear the tray before the clock runs out, or turn <b>Timer</b> off in Settings (it's on the pause screen too). Coins buy a freeze, a rocket, or a UFO. Nothing is behind a paywall, and retry is free.</p>
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
  const node = el(`<div class="screen solid"><div class="card" style="text-align:left">
    <h1 style="font-size:36px;text-align:center">Settings</h1>
    ${settingRow('timer', 'Timer')}
    <p class="note">Off: no countdown, no time-out, and no freeze booster. The tray can still be cleared.</p>
    ${settingRow('sound', 'Sound')}
    ${settingRow('haptics', 'Haptics')}
    ${settingRow('reduceMotion', 'Reduce motion')}
    ${settingRow('symbols', 'Color symbols')}
    <button class="btn" data-go="back" style="margin-top:16px;width:100%">Back</button>
  </div></div>`);
  bindSettings(node);
  node.querySelector('[data-go="back"]')!.addEventListener('click', () => open(settingsBack));
  return node;
}

function pauseScreen() {
  const node = el(`<div class="screen"><div class="card">
    <h1 style="font-size:40px">Paused</h1>
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
  const star = win ? stars(s.level.timer, s.timeLeft, s.boosters, !save.settings.timer) : 0;
  const gained = win ? s.gained : 0;
  const node = el(`<div class="screen"><div class="card">
    <h1 style="font-size:42px">${win ? 'Clear' : "Time's up"}</h1>
    <p class="sub">${win ? `${'★'.repeat(star)}${'☆'.repeat(3 - star)} · +${gained} coins` : 'The tray is still full.'}</p>
    <div class="stack">
      ${win ? `<button class="btn gold" data-go="next">Level ${s.level.n + 1}</button>` : ''}
      <button class="btn" data-go="retry">Retry</button>
      <button class="btn ghost" data-go="levels">Levels</button>
    </div>
  </div></div>`);
  node.querySelector('[data-go="next"]')?.addEventListener('click', () => startLevel(s.level.n + 1));
  node.querySelector('[data-go="retry"]')!.addEventListener('click', () => startLevel(s.level.n));
  node.querySelector('[data-go="levels"]')!.addEventListener('click', () => open('levels'));
  return node;
}

function open(next: Mode, back?: Mode) {
  if (back) settingsBack = back;
  audio.play('ui');
  mode = next;
  renderChrome();
}

function showToast(text: string) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  toastTimer = 1.6;
}

document.querySelector('#btn-pause')!.addEventListener('click', () => {
  if (mode !== 'play') return;
  persistProgress();
  mode = 'pause';
  renderChrome();
});
document.querySelector('#boost-clock')!.addEventListener('click', () => { audio.unlock(); useClock(); paintHud(); });
document.querySelector('#boost-rocket')!.addEventListener('click', () => { audio.unlock(); arm('rocket'); paintHud(); });
document.querySelector('#boost-ufo')!.addEventListener('click', () => { audio.unlock(); arm('ufo'); paintHud(); });

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
    s.live.forEach((live, i) => {
      if (live.lift > 0 && s.drag?.i !== i) live.lift = Math.max(0, live.lift - dt * 30);
    });
    const clock = tickClock(s.timeLeft, s.freeze, dt, save.settings.timer);
    s.timeLeft = clock.timeLeft;
    s.freeze = clock.freeze;
    if (s.exiting) {
      s.exiting.t += dt / 0.28;
      const k = Math.min(1, s.exiting.t);
      const ease = k * k;
      s.live[s.exiting.i].x = s.exiting.x + DX[s.exiting.dir] * ease * 1.15;
      s.live[s.exiting.i].y = s.exiting.y + DY[s.exiting.dir] * ease * 1.15;
      if (k >= 1 && s.exiting) finishExit(s, s.exiting.i);
    }
    if (clock.failed && !s.over) onFail();
    stepFx(s.frame, dt);
    if (Math.floor(s.frame.time) !== Math.floor(s.frame.time - dt)) persistProgress();
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) toastEl.classList.remove('show');
  }
  if (s) {
    s.frame.dragId = s.drag?.i ?? -1;
    s.frame.symbols = save.settings.symbols;
    s.frame.reduce = save.settings.reduceMotion;
    render(ctx, s.geom, s.frame);
    if (mode === 'play') paintHud();
  } else {
    ctx.fillStyle = '#1a100c';
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
};

// Infinite trays. Built by un-exiting bricks back through their gates
// (Murase-style reverse play), then confirmed with the forward solver.
// Level n is a pure function of (GEN_VERSION, n).

import { deadEndRatio } from './bots';
import { difficultyScore, playerSeconds } from './economy';
import { applyMove, makeState, occupancy, replay } from './rules';
import { analyze } from './rules';
import { hash32, Rng } from './rng';
import { beamSolve, solve } from './solver';
import { DOT, SHAPES } from './shapes';
import {
  DX,
  DY,
  type Dir,
  type Gate,
  type Label,
  type Level,
  type Metrics,
  type Move,
  type PieceDef,
  type Room,
  type Variant,
} from './types';

export const GEN_VERSION = 2;

const cache = new Map<number, { level: Level; witness: Move[] }>();

export function clearLevelCache(): void {
  cache.clear();
}

export function generateLevel(n: number): Level {
  return generateBuilt(n).level;
}

export function generateBuilt(n: number): { level: Level; witness: Move[] } {
  const hit = cache.get(n);
  if (hit) return hit;
  const built = build(n);
  cache.set(n, built);
  return built;
}

export function levelSignature(level: Level): string {
  const pcs = level.pieces
    .map((p) => [p.shape, p.color, p.x, p.y, p.ice, p.lock, p.keys, p.room].join(','))
    .join('|');
  const gs = level.gates.map((g) => [g.dir, g.along, g.span, g.color, g.ice].join(',')).join('|');
  const rooms = level.rooms.map((r) => [r.x, r.y, r.w, r.h, r.openAfter].join(',')).join('|');
  return [level.n, level.w, level.h, level.timer, level.label, level.variant, level.fallback ? 1 : 0, gs, rooms, pcs, level.metrics.minMoves, level.metrics.forcedOrderings].join(';');
}

interface Params {
  pieces: number;
  colors: number;
  variant: Variant;
  breather: boolean;
  maxPark: number;
  minPark: number;
  tuck: number;
  ice: boolean;
  iceGate: boolean;
  locks: boolean;
  room: boolean;
  minSetups: number;
  nodes: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function paramsFor(n: number): Params {
  const breather = n % 5 === 0;
  const t = breather ? Math.max(1, n - 4) : n;
  let pieces = clamp(Math.round(3 + 8 * (1 - Math.exp(-t / 110))), 3, 11);
  if (breather) pieces = Math.max(3, pieces - 1);
  const variant = variantFor(n, breather);
  let colors = variant === 'checker' ? 2 : clamp(1 + Math.floor((t - 1) / 12), 1, 5);
  colors = Math.min(colors, pieces);
  return {
    pieces,
    colors,
    variant,
    breather,
    maxPark: breather ? 1 : t < 12 ? 1 : t < 40 ? 2 : 3,
    minPark: breather || t < 6 ? 0 : 1,
    tuck: breather ? 0.12 : clamp(0.22 + t / 380, 0.22, 0.72),
    ice: n >= 8,
    iceGate: n >= 16,
    locks: n >= 22 && (!breather || n >= 45),
    room: variant === 'rect' && !breather && n >= 30 && n % 6 === 0,
    minSetups: breather ? 0 : t < 10 ? 0 : t < 24 ? 1 : t < 70 ? 2 : 3,
    nodes: 4000,
  };
}

function variantFor(n: number, breather: boolean): Variant {
  if (n >= 9 && n % 10 === 9) return 'checker';
  if (!breather && n >= 18 && n % 9 === 0) return 'chambers';
  if (!breather && n >= 14 && n % 7 === 0) return 'U';
  return 'rect';
}

function boardFor(pieces: number, variant: Variant): { w: number; h: number } {
  if (variant === 'chambers') return { w: pieces >= 8 ? 11 : 9, h: pieces >= 7 ? 6 : 5 };
  if (variant === 'U') return { w: 7, h: pieces >= 6 ? 8 : 7 };
  // Tight trays: bricks should cover most of the floor so every move depends on another.
  const span: Record<number, [number, number]> = {
    3: [4, 4],
    4: [4, 5],
    5: [5, 5],
    6: [5, 6],
    7: [5, 6],
    8: [6, 6],
    9: [6, 7],
    10: [6, 7],
    11: [7, 7],
  };
  const [w, h] = span[pieces] ?? [8, 9];
  return { w, h };
}

function opp(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}

interface Draft {
  level: Level;
  witness: Move[];
}

function build(n: number): { level: Level; witness: Move[] } {
  const params = paramsFor(n);
  const rng = new Rng(hash32(`block-out:${GEN_VERSION}:${n}`));
  let best: Draft | null = null;
  const fail = { build: 0, witness: 0, solve: 0, timer: 0 };
  for (let attempt = 0; attempt < 6; attempt++) {
    const draft = tryBuild(n, params, rng);
    if (!draft) { fail.build++; continue; }
    if (!replay(draft.level, draft.witness)) { fail.witness++; continue; }
    const beam = beamSolve(draft.level);
    const exact = beam?.solved ? solve(draft.level, params.nodes, 20) : null;
    const solved = exact?.solved ? exact : beam;
    if (!solved?.solved || !replay(draft.level, solved.moves)) { fail.solve++; continue; }
    const metrics = metricsOf(draft.level, draft.witness, solved);
    const timer = chooseTimer(n, params.breather, metrics);
    if (playerSeconds(n, metrics) + 0.5 >= timer) { fail.timer++; continue; }
    const level = finish(draft.level, metrics, timer, params);
    const candidate = { level, witness: draft.witness };
    if (!best || metrics.setups > best.level.metrics.setups) best = candidate;
    if (metrics.setups >= params.minSetups) break;
  }
  if (best) return best;
  if (process.env.GEN_DEBUG) console.log('fallback', n, fail, params);
  return fallback(n, params);
}

function metricsOf(level: Level, witness: Move[], solved: ReturnType<typeof solve>): Metrics {
  const colors = new Set(level.pieces.map((p) => p.color)).size;
  let obstacles = 0;
  for (const p of level.pieces) obstacles += (p.ice > 0 ? 1 : 0) + (p.lock > 0 ? 1 : 0);
  for (const g of level.gates) if (g.ice > 0) obstacles++;
  obstacles += level.rooms.length;
  const partial: Level = { ...level, metrics: emptyMetrics() };
  const dead = deadEndRatio(partial);
  return {
    minMoves: solved.minMoves,
    witnessMoves: witness.length,
    branching: round2(solved.branching),
    deadEndRatio: round2(dead),
    forcedOrderings: solved.forcedOrderings,
    nodes: solved.nodes,
    setups: solved.setups,
    pieces: level.pieces.length,
    colors,
    obstacles,
  };
}

function emptyMetrics(): Metrics {
  return { minMoves: 0, witnessMoves: 0, branching: 0, deadEndRatio: 0, forcedOrderings: 0, nodes: 0, setups: 0, pieces: 0, colors: 0, obstacles: 0 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function chooseTimer(n: number, breather: boolean, m: Metrics): number {
  const need = playerSeconds(n, m);
  const pressure = clamp((breather ? 0.34 : 0.46) + n / 900, 0.34, 0.8);
  const minT = breather ? 65 : Math.min(100, 50 + Math.floor(n / 6));
  const maxT = Math.min(180, 80 + Math.floor(n / 2.2));
  let timer = Math.round(need / pressure / 5) * 5;
  timer = clamp(timer, minT, maxT);
  if (need + 1 >= timer) timer = Math.min(180, Math.ceil((need + 5) / 5) * 5);
  return timer;
}

function labelFor(n: number, breather: boolean, m: Metrics): Label {
  if (breather) return 'Warmup';
  const score = difficultyScore(m);
  if (n >= 80 && score >= 48) return 'Super Hard';
  if (score >= 24) return 'Hard';
  return 'Normal';
}

function finish(level: Level, metrics: Metrics, timer: number, params: Params): Level {
  const label = labelFor(level.n, params.breather, metrics);
  const presented = present(level, params, label);
  return { ...level, timer, label, metrics, hint: presented.hint, mechanics: presented.mechanics };
}

function present(level: Level, params: Params, label: Label): { hint: string; mechanics: string[] } {
  const mechanics = ['gates'];
  if (level.variant === 'U' || level.variant === 'chambers') mechanics.push('pockets');
  if (level.variant === 'checker') mechanics.push('checker');
  if (level.pieces.some((p) => p.ice > 0)) mechanics.push('ice');
  if (level.gates.some((g) => g.ice > 0)) mechanics.push('ice-gate');
  if (level.pieces.some((p) => p.lock > 0)) mechanics.push('lock');
  if (level.rooms.length) mechanics.push('room');
  let hint = 'Drag a brick out through the gate of its color. It has to fit the opening.';
  if (level.rooms.length) hint = 'The crowned shutter opens when its count hits zero, and more bricks come with it.';
  else if (mechanics.includes('lock')) hint = 'A padlock stays put until enough key bricks have left.';
  else if (mechanics.includes('ice-gate')) hint = 'Frost on a gate melts as other bricks leave.';
  else if (mechanics.includes('ice')) hint = 'Frozen bricks thaw after enough bricks leave.';
  else if (level.variant === 'checker') hint = 'Ink out the black gate, paper out the white one. Order is the whole puzzle.';
  else if (level.variant === 'chambers') hint = 'Two pockets, two sets of gates. Clear each side.';
  else if (level.variant === 'U') hint = 'The tray bends. Bricks cannot cross the notch.';
  else if (label === 'Warmup') hint = 'A quieter tray. Same rules, more room to breathe.';
  else if (params.colors === 1) hint = 'One color. Slide each brick out through the gate it fits.';
  return { hint, mechanics };
}

function tryBuild(n: number, params: Params, rng: Rng): Draft | null {
  const { w, h } = boardFor(params.pieces, params.variant);
  const floor = new Uint8Array(w * h);
  floor.fill(1);
  if (params.variant === 'U') carveU(floor, w, h);
  if (params.variant === 'chambers') {
    const mid = Math.floor(w / 2);
    for (let y = 0; y < h; y++) floor[y * w + mid] = 0;
  }
  let room: Room | null = null;
  let innerCount = 0;
  if (params.room && w >= 6 && h >= 6 && params.pieces >= 6) {
    const rw = 3;
    const rh = 2;
    room = { x: w - rw, y: h - rh, w: rw, h: rh, openAfter: 0 };
    innerCount = 2;
  }
  const outerCount = params.pieces - innerCount;
  if (room) room.openAfter = outerCount;

  const level: Level = {
    n,
    w,
    h,
    floor,
    gates: [],
    pieces: [],
    rooms: room ? [room] : [],
    timer: 60,
    label: 'Normal',
    variant: params.variant,
    hint: '',
    mechanics: [],
    metrics: emptyMetrics(),
    fallback: false,
  };

  const pool = shapePool(n, params.variant, Math.max(w, h));
  const witness: Move[] = [];
  if (params.variant === 'chambers') {
    const mid = Math.floor(w / 2);
    const left = Math.ceil(outerCount / 2);
    const right = outerCount - left;
    const a = placeGroup(level, rng, params, pool, left, (x, y) => x < mid && !inRoom(room, x, y));
    if (!a) return null;
    witness.push(...a);
    const b = placeGroup(level, rng, params, pool, right, (x, y) => x > mid && !inRoom(room, x, y));
    if (!b) return null;
    witness.push(...b);
  } else {
    const placed = placeGroup(level, rng, params, pool, outerCount, (x, y) => !inRoom(room, x, y));
    if (!placed) return null;
    witness.push(...placed);
  }
  if (room && innerCount) {
    room.openAfter = 0;
    const inner = placeGroup(level, rng, { ...params, minPark: 0, maxPark: 1, tuck: 0.2 }, pool, innerCount, (x, y) => inRoom(room, x, y), 0);
    room.openAfter = outerCount;
    if (!inner) return null;
    for (const p of level.pieces) if (inRoom(room, p.x, p.y)) p.room = 0;
    witness.push(...inner);
  }
  if (!replay(level, witness)) return null;
  if (!decorate(level, witness, rng, params)) return null;
  if (!replay(level, witness)) return null;
  return { level, witness };
}

function inRoom(room: Room | null, x: number, y: number): boolean {
  if (!room) return false;
  return x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
}

function carveU(floor: Uint8Array, w: number, h: number) {
  const notchW = Math.max(2, Math.floor(w / 3));
  const notchH = Math.max(2, Math.floor(h / 3));
  const x0 = Math.floor((w - notchW) / 2);
  for (let y = h - notchH; y < h; y++) for (let x = x0; x < x0 + notchW; x++) floor[y * w + x] = 0;
}

function shapePool(level: number, variant: Variant, maxSpan: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < SHAPES.length; i++) {
    const s = SHAPES[i];
    if (s.minLevel > level) continue;
    if (s.w > maxSpan && s.h > maxSpan) continue;
    if (variant === 'checker' && s.w * s.h > 2) continue;
    ids.push(i);
  }
  return ids.length ? ids : [DOT];
}

function placeGroup(
  level: Level,
  rng: Rng,
  params: Params,
  pool: readonly number[],
  count: number,
  region: (x: number, y: number) => boolean,
  roomId = -1,
): Move[] | null {
  const plan: { shape: number; color: number }[] = [];
  for (let i = 0; i < count; i++) {
    const shape = pickWeighted(rng, pool);
    const color = i < params.colors ? i % params.colors : rng.int(0, params.colors);
    const s = SHAPES[shape];
    if (!regionFits(level, region, s.w, s.h) && shape !== DOT) {
      plan.push({ shape: DOT, color });
    } else plan.push({ shape, color });
  }
  const chunks: Move[][] = new Array(count);
  for (let p = count - 1; p >= 0; p--) {
    let moves = placeOne(level, rng, params, plan[p].shape, plan[p].color, region, roomId);
    if (!moves && plan[p].shape !== DOT) moves = placeOne(level, rng, params, DOT, plan[p].color, region, roomId);
    if (!moves) return null;
    chunks[p] = moves;
  }
  return chunks.flat();
}

/** Bigger bricks are picked more often: weight is cell count squared. */
function pickWeighted(rng: Rng, pool: readonly number[]): number {
  let total = 0;
  for (const id of pool) total += SHAPES[id].cells.length ** 2;
  let r = rng.float() * total;
  for (const id of pool) {
    r -= SHAPES[id].cells.length ** 2;
    if (r < 0) return id;
  }
  return pool[pool.length - 1];
}

function regionFits(level: Level, region: (x: number, y: number) => boolean, bw: number, bh: number): boolean {
  for (let y = 0; y <= level.h - bh; y++) {
    for (let x = 0; x <= level.w - bw; x++) {
      let ok = true;
      for (let dy = 0; dy < bh && ok; dy++) for (let dx = 0; dx < bw; dx++) if (!region(x + dx, y + dy) || !level.floor[(y + dy) * level.w + x + dx]) ok = false;
      if (ok) return true;
    }
  }
  return false;
}

function placeOne(
  level: Level,
  rng: Rng,
  params: Params,
  shapeId: number,
  color: number,
  region: (x: number, y: number) => boolean,
  roomId: number,
): Move[] | null {
  const shape = SHAPES[shapeId];
  const candidates = gateChoices(level, shape.w, shape.h, color, region);
  rng.shuffle(candidates);
  for (const gate of candidates) {
    const pos = alignment(level, shape.w, shape.h, gate);
    if (!pos) continue;
    if (!cellsOk(level, shapeId, pos.x, pos.y, region, -1)) continue;
    const piece: PieceDef = { shape: shapeId, color, x: pos.x, y: pos.y, ice: 0, lock: 0, keys: 0, room: roomId };
    level.pieces.push(piece);
    const id = level.pieces.length - 1;
    const fresh = !level.gates.includes(gate);
    if (fresh) level.gates.push(gate);
    const s = makeState(level);
    const exitA = analyze(level, s, occupancy(level, s), id, gate.dir);
    if (!exitA.exitAt) {
      level.pieces.pop();
      if (fresh) level.gates.pop();
      continue;
    }
    const backward: { dir: Dir; dist: number }[] = [];
    const parks = rng.int(params.minPark, params.maxPark + 1);
    let last: Dir | null = null;
    for (let k = 0; k < parks; k++) {
      const prefer: Dir = k === 0 ? opp(gate.dir) : (rng.int(0, 4) as Dir);
      if (!slideBack(level, s, id, prefer, last, rng, backward)) break;
      last = backward[backward.length - 1].dir;
    }
    if (rng.chance(params.tuck)) {
      const side: Dir = rng.chance(0.5) ? (((gate.dir + 1) % 4) as Dir) : (((gate.dir + 3) % 4) as Dir);
      slideBack(level, s, id, side, last, rng, backward);
    }
    piece.x = s.x[id];
    piece.y = s.y[id];
    const moves: Move[] = [];
    for (let k = backward.length - 1; k >= 0; k--) {
      moves.push({ i: id, dir: opp(backward[k].dir), dist: backward[k].dist, exit: false });
    }
    moves.push({ i: id, dir: gate.dir, dist: exitA.exitAt, exit: true });
    return moves;
  }
  return null;
}

function slideBack(
  level: Level,
  s: ReturnType<typeof makeState>,
  id: number,
  prefer: Dir,
  last: Dir | null,
  rng: Rng,
  into: { dir: Dir; dist: number }[],
): boolean {
  const order: Dir[] = [prefer, 0, 1, 2, 3];
  const seen = new Set<Dir>();
  const occ = occupancy(level, s);
  for (const dir of order) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    if (last !== null && dir === opp(last)) continue;
    const a = analyze(level, s, occ, id, dir);
    if (a.max < 1) continue;
    const dist = rng.int(1, a.max + 1);
    applyMove(level, s, { i: id, dir, dist, exit: false });
    into.push({ dir, dist });
    return true;
  }
  return false;
}

function cellsOk(level: Level, shapeId: number, x: number, y: number, region: (x: number, y: number) => boolean, self: number): boolean {
  const shape = SHAPES[shapeId];
  const occ = occupancy(level, makeState(level));
  for (const [dx, dy] of shape.cells) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx < 0 || cy < 0 || cx >= level.w || cy >= level.h) return false;
    if (!level.floor[cy * level.w + cx]) return false;
    if (!region(cx, cy)) return false;
    const v = occ[cy * level.w + cx];
    if (v === 255) return false;
    if (v !== 0 && v !== self + 1) return false;
  }
  return true;
}

function alignment(level: Level, bw: number, bh: number, gate: Gate): { x: number; y: number } | null {
  if ((gate.dir === 0 || gate.dir === 2) && gate.span !== bw) return null;
  if ((gate.dir === 1 || gate.dir === 3) && gate.span !== bh) return null;
  if (gate.dir === 0) return { x: gate.along, y: 0 };
  if (gate.dir === 2) return { x: gate.along, y: level.h - bh };
  if (gate.dir === 1) return { x: level.w - bw, y: gate.along };
  return { x: 0, y: gate.along };
}

function gateChoices(level: Level, bw: number, bh: number, color: number, region: (x: number, y: number) => boolean): Gate[] {
  const out: Gate[] = [];
  const seen = new Set<string>();
  const push = (g: Gate) => {
    const key = `${g.dir}:${g.along}:${g.span}:${g.color}`;
    if (seen.has(key)) return;
    const pos = alignment(level, bw, bh, g);
    if (!pos) return;
    seen.add(key);
    out.push(g);
  };
  for (const g of level.gates) if (g.color === color) push(g);
  const orients: { dir: Dir; span: number }[] = [
    { dir: 0, span: bw },
    { dir: 2, span: bw },
    { dir: 1, span: bh },
    { dir: 3, span: bh },
  ];
  for (const o of orients) {
    const limit = o.dir === 0 || o.dir === 2 ? level.w : level.h;
    for (let along = 0; along <= limit - o.span; along++) {
      if (!edgeFree(level, o.dir, along, o.span, region)) continue;
      push({ dir: o.dir, along, span: o.span, color, ice: 0 });
    }
  }
  return out;
}

function edgeFree(level: Level, dir: Dir, along: number, span: number, region: (x: number, y: number) => boolean): boolean {
  for (let i = 0; i < span; i++) {
    const x = dir === 0 || dir === 2 ? along + i : dir === 1 ? level.w - 1 : 0;
    const y = dir === 1 || dir === 3 ? along + i : dir === 0 ? 0 : level.h - 1;
    if (!level.floor[y * level.w + x]) return false;
    if (!region(x, y)) return false;
    const nx = x + DX[dir];
    const ny = y + DY[dir];
    if (nx >= 0 && ny >= 0 && nx < level.w && ny < level.h) return false;
  }
  for (const g of level.gates) {
    if (g.dir !== dir) continue;
    const a0 = along;
    const a1 = along + span;
    const b0 = g.along;
    const b1 = g.along + g.span;
    if (a0 < b1 && b0 < a1) return false;
  }
  return true;
}

function decorate(level: Level, witness: Move[], rng: Rng, params: Params): boolean {
  const firstClear = new Array<number>(level.pieces.length).fill(-1);
  const gateFirst = new Array<number>(level.gates.length).fill(-1);
  const exitOrder: number[] = [];
  const s = makeState(level);
  for (const move of witness) {
    if (firstClear[move.i] < 0) firstClear[move.i] = s.clears;
    if (move.exit) {
      exitOrder.push(move.i);
      const g = matchGate(level, s, move);
      if (g >= 0 && gateFirst[g] < 0) gateFirst[g] = s.clears;
    }
    applyMove(level, s, move);
  }
  if (params.locks && exitOrder.length >= 3 && rng.chance(0.8)) {
    const early = exitOrder.slice(0, Math.max(1, Math.ceil(exitOrder.length / 2)));
    const keyN = early.length > 1 && rng.chance(0.45) ? 2 : 1;
    rng.shuffle(early);
    for (const id of early.slice(0, keyN)) level.pieces[id].keys = 1;
    const s2 = makeState(level);
    const seen = new Array(level.pieces.length).fill(false);
    const keysBefore = new Array(level.pieces.length).fill(0);
    for (const move of witness) {
      if (!seen[move.i]) {
        seen[move.i] = true;
        keysBefore[move.i] = s2.keys;
      }
      applyMove(level, s2, move);
    }
    const candidates: number[] = [];
    for (let i = 0; i < level.pieces.length; i++) {
      if (level.pieces[i].keys || level.pieces[i].room >= 0) continue;
      if (keysBefore[i] > 0) candidates.push(i);
    }
    if (candidates.length) {
      const id = rng.pick(candidates);
      level.pieces[id].lock = Math.max(1, keysBefore[id]);
    }
  }
  if (params.locks) fixLock(level, witness);

  if (params.ice) {
    for (let i = 0; i < level.pieces.length; i++) {
      if (level.pieces[i].room >= 0 || level.pieces[i].lock > 0) continue;
      if (firstClear[i] > 0 && rng.chance(0.5)) level.pieces[i].ice = firstClear[i];
    }
  }
  if (params.iceGate) {
    for (let g = 0; g < level.gates.length; g++) {
      if (gateFirst[g] > 0 && rng.chance(0.45)) level.gates[g].ice = gateFirst[g];
    }
  }
  return true;
}

/** One locked brick, needing exactly the keys that have already left when it first moves. */
function fixLock(level: Level, witness: Move[]) {
  const locked = level.pieces.map((p, i) => (p.lock > 0 ? i : -1)).filter((i) => i >= 0);
  if (!locked.length) return;
  const id = locked[0];
  for (const i of locked) if (i !== id) level.pieces[i].lock = 0;
  const s = makeState(level);
  const seen = new Array(level.pieces.length).fill(false);
  let keys = 0;
  for (const move of witness) {
    if (!seen[move.i]) {
      seen[move.i] = true;
      if (move.i === id) keys = s.keys;
    }
    applyMove(level, s, move);
  }
  if (keys <= 0) {
    level.pieces[id].lock = 0;
    return;
  }
  level.pieces[id].lock = keys;
}

function matchGate(level: Level, s: ReturnType<typeof makeState>, move: Move): number {
  const shape = SHAPES[level.pieces[move.i].shape];
  const span = move.dir === 0 || move.dir === 2 ? shape.w : shape.h;
  const along = move.dir === 0 || move.dir === 2 ? s.x[move.i] : s.y[move.i];
  const color = level.pieces[move.i].color;
  return level.gates.findIndex((g) => g.dir === move.dir && g.span === span && g.along === along && g.color === color);
}

function fallback(n: number, params: Params): { level: Level; witness: Move[] } {
  const w = 5;
  const h = 4;
  const floor = new Uint8Array(w * h);
  floor.fill(1);
  const pieces: PieceDef[] = [0, 1, 2].map((i) => ({
    shape: DOT,
    color: i,
    x: i,
    y: 2,
    ice: 0,
    lock: 0,
    keys: 0,
    room: -1,
  }));
  const gates: Gate[] = [0, 1, 2].map((i) => ({ dir: 0 as Dir, along: i, span: 1, color: i, ice: 0 }));
  const witness: Move[] = pieces.map((_, i) => ({ i, dir: 0 as Dir, dist: 3, exit: true }));
  let level: Level = {
    n,
    w,
    h,
    floor,
    gates,
    pieces,
    rooms: [],
    timer: 70,
    label: params.breather ? 'Warmup' : 'Normal',
    variant: 'rect',
    hint: 'Drag a brick straight out through the gate of its color.',
    mechanics: ['gates'],
    metrics: emptyMetrics(),
    fallback: true,
  };
  const solved = solve(level, 4000);
  if (!solved.solved) throw new Error(`fallback level ${n} did not solve`);
  const metrics = metricsOf(level, witness, solved);
  level = finish(level, metrics, Math.max(chooseTimer(n, true, metrics), 70), params);
  level.fallback = true;
  return { level, witness };
}

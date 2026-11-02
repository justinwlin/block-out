// Infinite trays. Built by un-exiting bricks back through their gates
// (Murase-style reverse play), then confirmed with the forward solver.
// Level n is a pure function of (GEN_VERSION, n).

import { deadEndRatio } from './bots';
import { difficultyScore, playerSeconds } from './economy';
import { applyMove, gateFor, makeState, occupancy, replay } from './rules';
import { analyze } from './rules';
import { hash32, Rng } from './rng';
import { beamSolve, solve, type SolveResult } from './solver';
import { DOT, SHAPES } from './shapes';
import { COLORS } from './types';
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

export const GEN_VERSION = 5;

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
  /** Every 25th level: bigger, harder, labeled Milestone. */
  milestone: boolean;
  /** Fixed blocks carved into the floor. */
  pillars: number;
  /** Chance an eligible brick becomes one-way. */
  oneWay: number;
  /** Gates may get a use limit. */
  limitGates: boolean;
  /** Paint tiles to try to place. */
  paint: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function paramsFor(n: number): Params {
  const milestone = n >= 25 && n % 25 === 0;
  const breather = n % 5 === 0 && !milestone;
  const t = breather ? Math.max(1, n - 4) : n;
  let pieces = clamp(Math.round(3 + 8 * (1 - Math.exp(-t / 70))), 3, 11);
  if (breather) pieces = Math.max(3, pieces - 1);
  // Late game: one more brick from level 250, so difficulty keeps climbing past the curve's top.
  if (t >= 250 && !breather) pieces = 12;
  if (t >= 400 && !breather) pieces = 13;
  if (milestone) pieces = Math.min(13, pieces + 2);
  const variant = variantFor(n, breather);
  // One color for the first two levels, then a new color roughly every six levels, up to all six.
  let colors = variant === 'checker' ? 2 : t <= 2 ? 1 : clamp(2 + Math.floor((t - 3) / 6), 2, COLORS.length);
  colors = Math.min(colors, pieces);
  return {
    pieces,
    colors,
    variant,
    breather,
    maxPark: breather ? 1 : t < 12 ? 1 : t < 40 ? 2 : 3,
    minPark: breather || t < 6 ? 0 : 1,
    tuck: breather ? 0.12 : clamp(0.22 + t / 380, 0.22, 0.72),
    ice: n >= 4,
    iceGate: n >= 6,
    locks: n >= 10 && (!breather || n >= 30),
    room: variant === 'rect' && !breather && n >= 14 && n % 4 === 2,
    minSetups: (breather ? 0 : t < 10 ? 0 : t < 24 ? 1 : t < 70 ? 2 : t < 250 ? 3 : t < 400 ? 4 : 5) + (milestone ? 2 : 0),
    nodes: 20000,
    milestone,
    pillars: variant === 'rect' && !breather && n >= 5 && n % 3 !== 1 ? clamp(1 + Math.floor((n - 5) / 20), 1, 3) : 0,
    oneWay: n >= 8 && variant !== 'packed' ? clamp(0.25 + n / 800, 0.25, 0.6) : 0,
    limitGates: n >= 12 && variant !== 'packed',
    paint: n >= 16 && colors >= 2 && variant !== 'checker' && variant !== 'packed' ? (n >= 60 && !breather ? 2 : 1) : 0,
  };
}

function variantFor(n: number, breather: boolean): Variant {
  if (n >= 25 && n % 25 === 0) return 'rect';
  if (n >= 9 && n % 10 === 9) return 'checker';
  // Packed: every brick starts on the board with no empty cells.
  if (n >= 7 && n % 10 === 7) return 'packed';
  if (!breather && n >= 18 && n % 9 === 0) return 'chambers';
  if (!breather && n >= 14 && n % 7 === 0) return 'U';
  return 'rect';
}

function boardFor(pieces: number, variant: Variant): { w: number; h: number } {
  // Two pockets stacked top and bottom with a wall row between: tall, so it fits a portrait phone.
  if (variant === 'chambers') return { w: pieces >= 8 ? 6 : 5, h: pieces >= 7 ? 11 : 9 };
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
    12: [7, 7],
    13: [7, 8],
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

function build(n: number, override?: Partial<Params>): { level: Level; witness: Move[] } {
  const params = { ...paramsFor(n), ...override };
  const rng = new Rng(hash32(`block-out:${GEN_VERSION}:${n}`));
  const pool: { draft: Draft; quick: SolveResult; score: number }[] = [];
  const fail = { build: 0, witness: 0, solve: 0, timer: 0 };
  // More candidates later in the campaign, so the hardest pick keeps getting harder.
  const attempts = params.breather ? 6 : params.milestone ? 16 : params.variant === 'packed' ? 12 : Math.min(16, 10 + Math.floor(n / 100));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const draft = params.variant === 'packed' ? tryPacked(n, params, rng, attempt >= attempts / 2) : tryBuild(n, params, rng);
    if (!draft) { fail.build++; continue; }
    if (!replay(draft.level, draft.witness)) { fail.witness++; continue; }
    const quick = quickSolve(draft.level, params);
    if (!quick) { fail.solve++; continue; }
    const metrics = metricsOf(draft.level, draft.witness, quick);
    if (playerSeconds(n, metrics) + 0.5 >= chooseTimer(n, params.breather, metrics)) { fail.timer++; continue; }
    // Meeting the setup target outranks raw score.
    pool.push({ draft, quick, score: rankScore(draft.level, metrics, quick.moves, params) });
    // Warmups stop at the first acceptable tray; everything else tries every attempt.
    if (params.breather && metrics.setups >= params.minSetups) break;
  }
  if (!pool.length) {
    if (typeof process !== 'undefined' && process.env?.GEN_DEBUG) console.log('fallback', n, fail, params);
    // A packed tray that will not come together becomes a normal tray, not a trivial one.
    if (params.variant === 'packed') return build(n, { variant: 'rect', oneWay: 0.4, limitGates: true, paint: 1 });
    return fallback(n, params);
  }
  // The beam ranks every candidate; the exact solver re-measures the top three and picks.
  // Node-limited, never time-limited: level N must come out the same on every device.
  pool.sort((a, b) => b.score - a.score);
  let best: { level: Level; witness: Move[]; score: number } | null = null;
  // Full trays have huge position counts: re-measure only the top one.
  const packed = params.variant === 'packed';
  for (const { draft, quick } of pool.slice(0, packed ? 1 : 3)) {
    const exact = solve(draft.level, packed ? 8000 : params.nodes, Infinity);
    const solved = exact.solved && exact.minMoves <= quick.minMoves && replay(draft.level, exact.moves) ? exact : quick;
    const metrics = metricsOf(draft.level, draft.witness, solved);
    const timer = chooseTimer(n, params.breather, metrics);
    if (playerSeconds(n, metrics) + 0.5 >= timer) continue;
    const score = rankScore(draft.level, metrics, solved.moves, params);
    if (!best || score > best.score) {
      best = { level: finish(draft.level, metrics, timer, params), witness: draft.witness, score };
    }
  }
  if (!best) return fallback(n, params);
  return { level: best.level, witness: best.witness };
}

/**
 * How the generator ranks candidates. Meeting the setup target outranks everything; then
 * difficulty, plus a bonus for setup moves after a room opens, so a second room is a real
 * puzzle rather than a victory lap.
 */
function rankScore(level: Level, metrics: Metrics, moves: readonly Move[], params: Params): number {
  let score = difficultyScore(metrics) + (metrics.setups >= params.minSetups ? 1000 : 0);
  if (level.rooms.length) {
    const s = makeState(level);
    let late = 0;
    for (const m of moves) {
      if (!m.exit && s.clears >= level.rooms[0].openAfter) late++;
      applyMove(level, s, m);
    }
    score += late * 2;
  }
  return score;
}

/** Beam search for ranking; a tray the beam cannot clear is dropped and the next attempt runs. */
function quickSolve(level: Level, params: Params): SolveResult | null {
  const deep = params.milestone || params.paint >= 2 || params.variant === 'packed';
  const beam = beamSolve(level, deep ? 48 : 36, deep ? 11 : 7);
  return beam?.solved && replay(level, beam.moves) ? beam : null;
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
  // No ceiling: the clock grows with the puzzle instead of capping how hard a level may be.
  const maxT = 80 + Math.floor(n / 2.2);
  let timer = Math.round(need / pressure / 5) * 5;
  timer = clamp(timer, minT, maxT);
  if (need + 1 >= timer) timer = Math.ceil((need + 5) / 5) * 5;
  return timer;
}

function labelFor(n: number, breather: boolean, m: Metrics): Label {
  if (breather) return 'Warmup';
  if (n >= 25 && n % 25 === 0) return 'Milestone';
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
  if (level.pieces.some((p) => p.axis)) mechanics.push('one-way');
  if (level.gates.some((g) => g.uses)) mechanics.push('limited-gate');
  if (level.paint?.length) mechanics.push('paint');
  if (level.variant === 'packed') mechanics.push('packed');
  for (let i = 0; i < level.floor.length; i++) {
    const x = i % level.w;
    const y = Math.floor(i / level.w);
    if (!level.floor[i] && level.variant === 'rect' && x > 0 && y > 0 && x < level.w - 1 && y < level.h - 1) { mechanics.push('pillars'); break; }
  }
  let hint = 'Drag a brick out through the gate of its color. It has to fit the opening.';
  if (label === 'Milestone') hint = 'Milestone tray. Bigger and tougher than the levels around it.';
  else if (level.variant === 'packed') hint = 'A full tray. Find the brick that can leave first.';
  else if (level.paint?.length) hint = 'A brick that stops on a paint tile turns that color.';
  else if (mechanics.includes('limited-gate')) hint = 'A gate with dots closes after that many bricks pass through.';
  else if (mechanics.includes('one-way')) hint = 'Bricks with arrows only slide the way the arrows point.';
  else if (level.variant === 'chambers') hint = 'Two rooms. Clear the top one and the shutter lifts on the bottom.';
  else if (level.rooms.length) hint = 'The crowned shutter opens when its count hits zero, and more bricks come with it.';
  else if (mechanics.includes('lock')) hint = 'A padlock stays put until enough key bricks have left.';
  else if (mechanics.includes('ice-gate')) hint = 'Frost on a gate melts as other bricks leave.';
  else if (mechanics.includes('ice')) hint = 'Frozen bricks thaw after enough bricks leave.';
  else if (level.variant === 'checker') hint = 'Ink out the black gate, paper out the white one. Order is the whole puzzle.';
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
  const mid = Math.floor(h / 2);
  if (params.variant === 'chambers') {
    for (let x = 0; x < w; x++) floor[mid * w + x] = 0;
    // One door in the wall, so bricks can cross between the rooms once the bottom opens.
    floor[mid * w + rng.int(0, w)] = 1;
  }
  carvePillars(floor, w, h, params.pillars, rng);
  let room: Room | null = null;
  let innerCount = 0;
  if (params.variant === 'chambers') {
    // The bottom pocket is shuttered until the top pocket is clear: one room, then the next.
    room = { x: 0, y: mid + 1, w, h: h - mid - 1, openAfter: 0 };
    innerCount = Math.floor(params.pieces / 2);
  } else if (params.room && w >= 6 && h >= 6 && params.pieces >= 6) {
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
    const top = placeGroup(level, rng, params, pool, outerCount, (_x, y) => y < mid);
    if (!top) return null;
    witness.push(...top);
  } else {
    const placed = placeGroup(level, rng, params, pool, outerCount, (x, y) => !inRoom(room, x, y));
    if (!placed) return null;
    witness.push(...placed);
  }
  if (room && innerCount) {
    room.openAfter = 0;
    // Room bricks get the level's full difficulty; the room is half the puzzle, not a bonus.
    const inner = placeGroup(level, rng, params, pool, innerCount, (x, y) => inRoom(room, x, y), 0);
    // Open one clear early, so the last outside brick is still in play when the room opens.
    room.openAfter = outerCount >= 3 ? outerCount - 1 : outerCount;
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

/** Fixed one-cell blocks inside the tray, never on the edge and never touching each other. */
function carvePillars(floor: Uint8Array, w: number, h: number, count: number, rng: Rng) {
  if (w < 4 || h < 4) return;
  for (let k = 0, tries = 0; k < count && tries < 40; tries++) {
    const x = rng.int(1, w - 1);
    const y = rng.int(1, h - 1);
    let clear = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!floor[(y + dy) * w + x + dx]) clear = false;
    if (!clear) continue;
    floor[y * w + x] = 0;
    k++;
  }
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
  for (let k = 0; k < params.paint; k++) addPaint(level, witness, rng, params);
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
      if (level.pieces[i].keys) continue;
      if (keysBefore[i] > 0) candidates.push(i);
    }
    if (candidates.length) {
      const id = rng.pick(candidates);
      level.pieces[id].lock = Math.max(1, keysBefore[id]);
    }
  }
  if (params.locks) fixLock(level, witness);
  if (params.oneWay > 0) addOneWay(level, witness, rng, params.oneWay);
  // Keys only mean something if a padlock survived; otherwise drop them.
  if (!level.pieces.some((p) => p.lock > 0)) for (const p of level.pieces) p.keys = 0;

  if (params.ice) {
    for (let i = 0; i < level.pieces.length; i++) {
      const p = level.pieces[i];
      if (p.lock > 0) continue;
      // A room brick only gets ice that outlasts the shutter; otherwise it would thaw unseen.
      if (p.room >= 0 && firstClear[i] <= level.rooms[p.room].openAfter) continue;
      if (firstClear[i] > 0 && rng.chance(iceChance(level.n))) level.pieces[i].ice = firstClear[i];
    }
  }
  if (params.iceGate) {
    for (let g = 0; g < level.gates.length; g++) {
      if (gateFirst[g] > 0 && rng.chance(iceChance(level.n) * 0.9)) level.gates[g].ice = gateFirst[g];
    }
  }
  // Last, so frozen gates are known and skipped: a gate is either frozen or limited, not both.
  if (params.limitGates) limitGates(level, witness, rng);
  return true;
}

/**
 * Chance an eligible brick (or gate) starts frozen: 40% when ice arrives, 50% from level 20.
 * Higher rates make late trays too tangled for the solver to confirm.
 */
function iceChance(n: number): number {
  // Holds at 50% from level 20, then creeps up after 200 so the late game keeps tightening.
  return clamp(0.4 + n / 200, 0.4, 0.5) + clamp((n - 200) / 2000, 0, 0.15);
}

/**
 * Paint: pick a brick that rests somewhere before it leaves, put a tile of its color under
 * that resting spot, and start the brick in another color. The witness still works because
 * the brick picks up its color right where it already stopped. Reverted if replay breaks.
 */
function addPaint(level: Level, witness: Move[], rng: Rng, params: Params) {
  // Bricks at the start, rooms counted as open, so a tile never hides under a brick.
  const s0 = makeState(level);
  s0.clears = level.pieces.length;
  const start = occupancy(level, s0);
  const s = makeState(level);
  const rests: { i: number; x: number; y: number }[] = [];
  const left = new Set<number>();
  for (const move of witness) {
    applyMove(level, s, move);
    if (move.exit) left.add(move.i);
    else if (!left.has(move.i)) rests.push({ i: move.i, x: s.x[move.i], y: s.y[move.i] });
  }
  rng.shuffle(rests);
  const painted = new Set((level.paint ?? []).map((t) => t.y * level.w + t.x));
  const owners = new Set((level.paint ?? []).map((t) => t.color));
  for (const r of rests.slice(0, 6)) {
    const piece = level.pieces[r.i];
    if (painted.size && owners.has(piece.color)) continue;
    const cells = SHAPES[piece.shape].cells.map(([dx, dy]) => [r.x + dx, r.y + dy] as const).filter(([x, y]) => start[y * level.w + x] === 0 && !painted.has(y * level.w + x));
    if (!cells.length) continue;
    const [x, y] = rng.pick(cells);
    const others = Array.from({ length: params.colors }, (_, c) => c).filter((c) => c !== piece.color);
    if (!others.length) return;
    const original = piece.color;
    level.paint = [...(level.paint ?? []), { x, y, color: original }];
    piece.color = rng.pick(others);
    if (replay(level, witness)) return;
    piece.color = original;
    level.paint.pop();
    if (!level.paint.length) delete level.paint;
  }
}

/** One-way: a brick whose whole witness path runs along one axis may be locked to it. */
function addOneWay(level: Level, witness: Move[], rng: Rng, chance: number) {
  const horiz = new Array<boolean>(level.pieces.length).fill(true);
  const vert = new Array<boolean>(level.pieces.length).fill(true);
  for (const move of witness) {
    if (move.dir === 1 || move.dir === 3) vert[move.i] = false;
    else horiz[move.i] = false;
  }
  for (let i = 0; i < level.pieces.length; i++) {
    const p = level.pieces[i];
    if (p.lock > 0 || p.keys > 0) continue;
    if (!rng.chance(chance)) continue;
    if (horiz[i]) p.axis = 1;
    else if (vert[i]) p.axis = 2;
  }
}

/**
 * Gate limits: a gate the witness uses k times may close after k bricks, but only when
 * another brick of the same color and width could also have used it. That turns a
 * spare route into a choice the player has to get right.
 */
function limitGates(level: Level, witness: Move[], rng: Rng) {
  const used = new Array<number>(level.gates.length).fill(0);
  const s = makeState(level);
  for (const move of witness) {
    if (move.exit) {
      const g = gateFor(level, s, move.i, move.dir, s.x[move.i] + DX[move.dir] * move.dist, s.y[move.i] + DY[move.dir] * move.dist);
      if (g >= 0) used[g]++;
    }
    applyMove(level, s, move);
  }
  for (let g = 0; g < level.gates.length; g++) {
    const gate = level.gates[g];
    if (!used[g] || used[g] > 3 || gate.ice > 0) continue;
    const vertical = gate.dir === 0 || gate.dir === 2;
    const fits = level.pieces.filter((p) => {
      const sh = SHAPES[p.shape];
      return (vertical ? sh.w : sh.h) === gate.span && (p.color === gate.color || level.paint?.some((t) => t.color === gate.color));
    }).length;
    if (fits > used[g] && rng.chance(0.6)) gate.uses = used[g];
  }
}

/**
 * Packed tray: tile the whole board with bricks, give each brick a gate in line with it
 * (sometimes offset so it has to slide first), and keep it only if the solver clears it.
 * The solver's line becomes the witness.
 */
function tryPacked(n: number, params: Params, rng: Rng, smaller = false): Draft | null {
  const sizes: [number, number][] = [[4, 4], [4, 5], [5, 5], [5, 6], [6, 6]];
  const target = n < 40 ? 1 : n < 100 ? 2 : n < 200 ? 3 : 4;
  // Later attempts step down a size when the full tray will not come together.
  const [w, h] = sizes[smaller ? target - 1 : target];
  const floor = new Uint8Array(w * h).fill(1);
  const level: Level = {
    n, w, h, floor, gates: [], pieces: [], rooms: [], timer: 60, label: 'Normal',
    variant: 'packed', hint: '', mechanics: [], metrics: emptyMetrics(), fallback: false,
  };
  const pool = shapePool(n, 'rect', Math.max(w, h)).filter((id) => SHAPES[id].w <= w && SHAPES[id].h <= h);
  const grid = new Int16Array(w * h).fill(-1);
  for (let c = 0; c < w * h; c++) {
    if (grid[c] >= 0) continue;
    const cx = c % w;
    const cy = Math.floor(c / w);
    let placed = false;
    for (let t = 0; t < 8 && !placed; t++) {
      const id = t < 7 ? pickWeighted(rng, pool) : DOT;
      const sh = SHAPES[id];
      // cells[0] is the shape's first cell in reading order; anchor it on the empty cell.
      const ox = cx - sh.cells[0][0];
      const oy = cy - sh.cells[0][1];
      if (ox < 0 || oy < 0 || ox + sh.w > w || oy + sh.h > h) continue;
      if (!sh.cells.every(([dx, dy]) => grid[(oy + dy) * w + ox + dx] < 0)) continue;
      const idx = level.pieces.length;
      for (const [dx, dy] of sh.cells) grid[(oy + dy) * w + ox + dx] = idx;
      // At most four colors, so bricks can share gates and the edges have room for them all.
      level.pieces.push({ shape: id, color: rng.int(0, Math.min(4, params.colors)), x: ox, y: oy, ice: 0, lock: 0, keys: 0, room: -1 });
      placed = true;
    }
    if (!placed) return null;
  }
  const order = level.pieces.map((_, i) => i);
  rng.shuffle(order);
  for (const i of order) {
    const p = level.pieces[i];
    const sh = SHAPES[p.shape];
    const dirs: Dir[] = [0, 1, 2, 3];
    rng.shuffle(dirs);
    let ok = false;
    for (const dir of dirs) {
      const vertical = dir === 0 || dir === 2;
      const span = vertical ? sh.w : sh.h;
      const limit = (vertical ? w : h) - span;
      const inLine = vertical ? p.x : p.y;
      // In line first (or offset a third of the time), then every other spot on that side.
      const spots = Array.from({ length: limit + 1 }, (_, a) => a).filter((a) => a !== inLine);
      rng.shuffle(spots);
      if (rng.chance(0.35)) spots.push(inLine); else spots.unshift(inLine);
      for (const along of spots) {
        const same = level.gates.find((g) => g.dir === dir && g.along === along && g.span === span && g.color === p.color);
        if (same) { ok = true; break; }
        const clash = level.gates.some((g) => g.dir === dir && along < g.along + g.span && g.along < along + span);
        if (clash) continue;
        level.gates.push({ dir, along, span, color: p.color, ice: 0 });
        ok = true;
        break;
      }
      if (ok) break;
    }
    if (!ok) return null;
  }
  const solved = beamSolve(level, 48, 11);
  if (!solved?.solved) return null;
  return { level, witness: solved.moves };
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
  const color = s.color[move.i];
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

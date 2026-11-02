// Geometry of one tray: slides, exits, ice, locks, shutters.
// A drag is one straight move of any distance. Leaving is the step that
// would carry the brick off through a fitting gate; the brick is removed
// whole on that step.

import { SHAPES } from './shapes';
import { DX, DY, type Dir, type Level, type Move, type SimState } from './types';

export function makeState(level: Level): SimState {
  const n = level.pieces.length;
  const x = new Int16Array(n);
  const y = new Int16Array(n);
  const color = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = level.pieces[i].x;
    y[i] = level.pieces[i].y;
    color[i] = level.pieces[i].color;
  }
  return { x, y, out: new Uint8Array(n), color, passed: new Uint8Array(level.gates.length), clears: 0, keys: 0 };
}

export function cloneState(s: SimState): SimState {
  return { x: s.x.slice(), y: s.y.slice(), out: s.out.slice(), color: s.color.slice(), passed: s.passed.slice(), clears: s.clears, keys: s.keys };
}

/** One-way bricks only slide along their axis. */
export function dirAllowed(level: Level, piece: number, dir: Dir): boolean {
  const axis = level.pieces[piece].axis ?? 0;
  if (axis === 1) return dir === 1 || dir === 3;
  if (axis === 2) return dir === 0 || dir === 2;
  return true;
}

/** True once a limited gate has let through all the bricks it allows. */
export function gateClosed(level: Level, s: SimState, g: number): boolean {
  const uses = level.gates[g].uses ?? 0;
  return uses > 0 && s.passed[g] >= uses;
}

/** A brick whose slide ends with any cell on a paint tile takes that tile's color. */
export function settlePaint(level: Level, s: SimState, piece: number): void {
  if (!level.paint?.length) return;
  const shape = SHAPES[level.pieces[piece].shape];
  for (const t of level.paint) {
    for (const [dx, dy] of shape.cells) {
      if (s.x[piece] + dx === t.x && s.y[piece] + dy === t.y) {
        s.color[piece] = t.color;
        return;
      }
    }
  }
}

export function won(level: Level, s: SimState): boolean {
  for (let i = 0; i < level.pieces.length; i++) if (!s.out[i]) return false;
  return true;
}

export function roomOpen(level: Level, room: number, clears: number): boolean {
  return clears >= level.rooms[room].openAfter;
}

export function pieceActive(level: Level, s: SimState, i: number): boolean {
  if (s.out[i]) return false;
  const room = level.pieces[i].room;
  if (room >= 0 && !roomOpen(level, room, s.clears)) return false;
  return true;
}

export function canMove(level: Level, s: SimState, i: number): boolean {
  if (!pieceActive(level, s, i)) return false;
  const p = level.pieces[i];
  if (s.clears < p.ice) return false;
  if (s.keys < p.lock) return false;
  return true;
}

/** Floor and closed-room cells for each combination of open rooms. Room geometry never changes. */
const baseCache = new WeakMap<Level, Map<number, Uint8Array>>();

function baseGrid(level: Level, clears: number): Uint8Array {
  let mask = 0;
  for (let r = 0; r < level.rooms.length; r++) if (!roomOpen(level, r, clears)) mask |= 1 << r;
  let byMask = baseCache.get(level);
  if (!byMask) {
    byMask = new Map();
    baseCache.set(level, byMask);
  }
  let grid = byMask.get(mask);
  if (!grid) {
    const { w, h } = level;
    grid = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (!level.floor[i]) grid[i] = 255;
    for (let r = 0; r < level.rooms.length; r++) {
      if (!(mask & (1 << r))) continue;
      const room = level.rooms[r];
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) grid[y * w + x] = 255;
    }
    byMask.set(mask, grid);
  }
  return grid;
}

/** 0 free, 255 solid, otherwise piece index + 1. The moving piece is not solid to itself. */
export function occupancy(level: Level, s: SimState): Uint8Array {
  const { w } = level;
  const o = baseGrid(level, s.clears).slice();
  for (let i = 0; i < level.pieces.length; i++) {
    if (!pieceActive(level, s, i)) continue;
    const cells = SHAPES[level.pieces[i].shape].cells;
    const base = s.y[i] * w + s.x[i];
    for (let c = 0; c < cells.length; c++) o[base + cells[c][1] * w + cells[c][0]] = i + 1;
  }
  return o;
}

/**
 * Cells on a shape's leading edge for each direction: the only cells that can hit
 * something new on a one-step slide. The rest move into cells the shape just left.
 */
const leadCache: Int8Array[][] = [];

function leading(shapeId: number, dir: Dir): Int8Array {
  let byDir = leadCache[shapeId];
  if (!byDir) {
    const cells = SHAPES[shapeId].cells;
    const has = new Set(cells.map(([x, y]) => `${x},${y}`));
    byDir = [0, 1, 2, 3].map((d) => {
      const out: number[] = [];
      for (const [x, y] of cells) if (!has.has(`${x + DX[d]},${y + DY[d]}`)) out.push(x, y);
      return Int8Array.from(out);
    });
    leadCache[shapeId] = byDir;
  }
  return byDir[dir];
}

/** True if some open gate of the brick's color and width lines up with the brick going `dir`. */
function lined(level: Level, s: SimState, piece: number, dir: Dir): boolean {
  const shape = SHAPES[level.pieces[piece].shape];
  const vertical = dir === 0 || dir === 2;
  const span = vertical ? shape.w : shape.h;
  const along = vertical ? s.x[piece] : s.y[piece];
  const color = s.color[piece];
  for (let g = 0; g < level.gates.length; g++) {
    const gate = level.gates[g];
    if (gate.dir === dir && gate.along === along && gate.span === span && gate.color === color && s.clears >= gate.ice && !gateClosed(level, s, g)) return true;
  }
  return false;
}

/** Index of the open gate a brick at (x, y) would leave through going `dir`, or -1. */
export function gateFor(level: Level, s: SimState, piece: number, dir: Dir, x: number, y: number): number {
  const shape = SHAPES[level.pieces[piece].shape];
  const color = s.color[piece];
  const span = dir === 0 || dir === 2 ? shape.w : shape.h;
  const along = dir === 0 || dir === 2 ? x : y;
  for (let g = 0; g < level.gates.length; g++) {
    const gate = level.gates[g];
    if (gate.dir !== dir || gate.color !== color || gate.span !== span || gate.along !== along) continue;
    if (s.clears < gate.ice || gateClosed(level, s, g)) continue;
    return g;
  }
  return -1;
}

/**
 * Walk one direction.
 * `max` is the farthest distance that stays fully on the tray.
 * `exitAt` is the distance that leaves through a fitting gate, or 0.
 */
export function analyze(level: Level, s: SimState, occ: Uint8Array, piece: number, dir: Dir): { max: number; exitAt: number } {
  if (!dirAllowed(level, piece, dir)) return { max: 0, exitAt: 0 };
  const lead = leading(level.pieces[piece].shape, dir);
  const { w, h } = level;
  const self = piece + 1;
  let max = 0;
  for (let step = 1; step <= w + h; step++) {
    const nx = s.x[piece] + DX[dir] * step;
    const ny = s.y[piece] + DY[dir] * step;
    let anyOut = false;
    let blocked = false;
    for (let k = 0; k < lead.length; k += 2) {
      const cx = nx + lead[k];
      const cy = ny + lead[k + 1];
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) {
        anyOut = true;
        continue;
      }
      const v = occ[cy * w + cx];
      if (v !== 0 && v !== self) {
        blocked = true;
        break;
      }
    }
    if (blocked) return { max, exitAt: 0 };
    if (anyOut) {
      if (gateFor(level, s, piece, dir, nx, ny) >= 0) return { max, exitAt: step };
      return { max, exitAt: 0 };
    }
    max = step;
  }
  return { max, exitAt: 0 };
}

export function legalMoves(level: Level, s: SimState): Move[] {
  const occ = occupancy(level, s);
  const moves: Move[] = [];
  for (let i = 0; i < level.pieces.length; i++) {
    if (!canMove(level, s, i)) continue;
    for (let dir = 0 as Dir; dir < 4; dir++) {
      const a = analyze(level, s, occ, i, dir);
      for (let d = 1; d <= a.max; d++) moves.push({ i, dir, dist: d, exit: false });
      if (a.exitAt) moves.push({ i, dir, dist: a.exitAt, exit: true });
    }
  }
  return moves;
}

export function applyMove(level: Level, s: SimState, move: Move): void {
  if (move.exit) {
    // An exit's `dist` is the step that carries the brick off the tray, so the gate is there.
    const g = gateFor(level, s, move.i, move.dir, s.x[move.i] + DX[move.dir] * move.dist, s.y[move.i] + DY[move.dir] * move.dist);
    if (g >= 0) s.passed[g]++;
    s.out[move.i] = 1;
    s.clears++;
    s.keys += level.pieces[move.i].keys;
    return;
  }
  s.x[move.i] += DX[move.dir] * move.dist;
  s.y[move.i] += DY[move.dir] * move.dist;
  settlePaint(level, s, move.i);
}

/** Take every exit that is already a straight drag, lowest piece id first. */
export function takeFreeExits(level: Level, s: SimState, into?: Move[]): number {
  let n = 0;
  for (;;) {
    const occ = occupancy(level, s);
    let move: Move | null = null;
    for (let i = 0; i < level.pieces.length && !move; i++) {
      if (!canMove(level, s, i)) continue;
      for (let dir = 0 as Dir; dir < 4; dir++) {
        // Cheap filter first: an exit needs a gate in line with the brick.
        if (!lined(level, s, i, dir)) continue;
        const a = analyze(level, s, occ, i, dir);
        if (a.exitAt) {
          move = { i, dir, dist: a.exitAt, exit: true };
          break;
        }
      }
    }
    if (!move) break;
    applyMove(level, s, move);
    into?.push(move);
    n++;
    if (n > level.pieces.length + 2) break;
  }
  return n;
}

export function replay(level: Level, moves: readonly Move[]): boolean {
  const s = makeState(level);
  for (const move of moves) {
    const legal = legalMoves(level, s);
    const ok = legal.some((m) => m.i === move.i && m.dir === move.dir && m.dist === move.dist && m.exit === move.exit);
    if (!ok) return false;
    applyMove(level, s, move);
  }
  return won(level, s);
}

/** Hashable position: one char per brick (color, x, y, or gone) plus one per gate pass count. */
export function stateKey(s: SimState): string {
  let k = '';
  for (let i = 0; i < s.x.length; i++) {
    k += String.fromCharCode(s.out[i] ? 0xffff : ((s.color[i] & 7) << 8) | ((s.x[i] & 15) << 4) | (s.y[i] & 15));
  }
  for (let g = 0; g < s.passed.length; g++) k += String.fromCharCode(48 + s.passed[g]);
  return k;
}

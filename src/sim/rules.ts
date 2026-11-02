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
  for (let i = 0; i < n; i++) {
    x[i] = level.pieces[i].x;
    y[i] = level.pieces[i].y;
  }
  return { x, y, out: new Uint8Array(n), clears: 0, keys: 0 };
}

export function cloneState(s: SimState): SimState {
  return { x: s.x.slice(), y: s.y.slice(), out: s.out.slice(), clears: s.clears, keys: s.keys };
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

/** 0 free, 255 solid, otherwise piece index + 1. The moving piece is not solid to itself. */
export function occupancy(level: Level, s: SimState): Uint8Array {
  const { w, h } = level;
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!level.floor[i]) {
        o[i] = 255;
        continue;
      }
      for (let r = 0; r < level.rooms.length; r++) {
        const room = level.rooms[r];
        if (x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h && !roomOpen(level, r, s.clears)) {
          o[i] = 255;
          break;
        }
      }
    }
  }
  for (let i = 0; i < level.pieces.length; i++) {
    if (!pieceActive(level, s, i)) continue;
    const shape = SHAPES[level.pieces[i].shape];
    for (const [dx, dy] of shape.cells) o[(s.y[i] + dy) * w + (s.x[i] + dx)] = i + 1;
  }
  return o;
}

function fitsGate(level: Level, s: SimState, piece: number, dir: Dir, x: number, y: number): boolean {
  const shape = SHAPES[level.pieces[piece].shape];
  const color = level.pieces[piece].color;
  const span = dir === 0 || dir === 2 ? shape.w : shape.h;
  const along = dir === 0 || dir === 2 ? x : y;
  for (const g of level.gates) {
    if (g.dir !== dir || g.color !== color || g.span !== span || g.along !== along) continue;
    if (s.clears < g.ice) continue;
    return true;
  }
  return false;
}

/**
 * Walk one direction.
 * `max` is the farthest distance that stays fully on the tray.
 * `exitAt` is the distance that leaves through a fitting gate, or 0.
 */
export function analyze(level: Level, s: SimState, occ: Uint8Array, piece: number, dir: Dir): { max: number; exitAt: number } {
  const shape = SHAPES[level.pieces[piece].shape];
  const { w, h } = level;
  let max = 0;
  for (let step = 1; step <= w + h; step++) {
    const nx = s.x[piece] + DX[dir] * step;
    const ny = s.y[piece] + DY[dir] * step;
    let anyOut = false;
    let blocked = false;
    for (const [dx, dy] of shape.cells) {
      const cx = nx + dx;
      const cy = ny + dy;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) {
        anyOut = true;
        continue;
      }
      const v = occ[cy * w + cx];
      if (v !== 0 && v !== piece + 1) {
        blocked = true;
        break;
      }
    }
    if (blocked) return { max, exitAt: 0 };
    if (anyOut) {
      if (fitsGate(level, s, piece, dir, nx, ny)) return { max, exitAt: step };
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
    s.out[move.i] = 1;
    s.clears++;
    s.keys += level.pieces[move.i].keys;
    return;
  }
  s.x[move.i] += DX[move.dir] * move.dist;
  s.y[move.i] += DY[move.dir] * move.dist;
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

export function stateKey(s: SimState): bigint {
  let k = 0n;
  for (let i = 0; i < s.x.length; i++) {
    const packed = s.out[i] ? 0x1ff : ((s.x[i] & 15) << 4) | (s.y[i] & 15);
    k = (k << 9n) | BigInt(packed);
  }
  return k;
}

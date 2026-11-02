// How much planning a tray asks for. The generator ranks on these and the design
// report prints them. A tray is shallow when one-move lookahead clears it.

import { greedyPlayout } from './bots';
import { analyze, applyMove, canMove, cloneState, legalMoves, makeState, occupancy } from './rules';
import type { Level, Move, SimState } from './types';

export interface Depth {
  /** Positions on the solution with no exit open and no single slide that opens one. */
  deep: number;
  /** Most slides in a row the solution makes before the next exit. */
  maxChain: number;
  /** Share of greedy playthroughs (exit when you can, else a slide that opens one) that clear the tray. */
  greedyWins: number;
}

/** True if some brick can leave right now. */
export function exitOpen(level: Level, s: SimState): boolean {
  const occ = occupancy(level, s);
  for (let i = 0; i < level.pieces.length; i++) {
    if (!canMove(level, s, i)) continue;
    for (let d = 0; d < 4; d++) if (analyze(level, s, occ, i, d as 0 | 1 | 2 | 3).exitAt) return true;
  }
  return false;
}

/** True if one slide (not an exit) opens an exit. */
export function oneSlideFromExit(level: Level, s: SimState): boolean {
  for (const m of legalMoves(level, s)) {
    if (m.exit) continue;
    const next = cloneState(s);
    applyMove(level, next, m);
    if (exitOpen(level, next)) return true;
  }
  return false;
}

export function chainStats(level: Level, moves: readonly Move[]): { deep: number; maxChain: number } {
  const s = makeState(level);
  let deep = 0;
  let chain = 0;
  let maxChain = 0;
  for (const move of moves) {
    if (move.exit) {
      chain = 0;
    } else {
      chain++;
      maxChain = Math.max(maxChain, chain);
      if (!exitOpen(level, s) && !oneSlideFromExit(level, s)) deep++;
    }
    applyMove(level, s, move);
  }
  return { deep, maxChain };
}

export function greedyWinRate(level: Level, minMoves: number, seeds = 6): number {
  // A greedy player gets a fair number of moves: twice the shortest line, plus slack.
  const cap = minMoves * 2 + 10;
  let wins = 0;
  for (let k = 0; k < seeds; k++) if (greedyPlayout(level, 7000 + level.n * 31 + k, cap).result === 'win') wins++;
  return wins / seeds;
}

export function depthOf(level: Level, moves: readonly Move[]): Depth {
  return { ...chainStats(level, moves), greedyWins: greedyWinRate(level, moves.length) };
}

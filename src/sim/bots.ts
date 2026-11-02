// Headless agents. The solver bot is "play the shortest solution".
// Greedy exits whenever a brick can leave, otherwise tries a slide that
// frees one. Random wanders, and is how dead-ends are sampled.

import { applyMove, cloneState, legalMoves, makeState, takeFreeExits, won } from './rules';
import { Rng } from './rng';
import type { Level, Move } from './types';

export type Playout = 'win' | 'stuck' | 'cap';

export function randomPlayout(level: Level, seed: number, cap = 64): Playout {
  const rng = new Rng(seed);
  const s = makeState(level);
  for (let m = 0; m < cap; m++) {
    if (won(level, s)) return 'win';
    const moves = legalMoves(level, s);
    if (!moves.length) return 'stuck';
    const exits = moves.filter((mv) => mv.exit);
    const pool = exits.length && rng.chance(0.62) ? exits : moves;
    applyMove(level, s, rng.pick(pool));
  }
  return won(level, s) ? 'win' : 'cap';
}

/** Share of short random tries that never clear the tray (stuck, or out of moves). */
export function deadEndRatio(level: Level): number {
  let fail = 0;
  const cap = Math.max(20, level.pieces.length * 3);
  for (let t = 0; t < 6; t++) {
    if (randomPlayout(level, 9000 + level.n * 13 + t, cap) !== 'win') fail++;
  }
  return fail / 6;
}

export function greedyPlayout(level: Level, seed: number, cap = 100): { result: Playout; moves: number } {
  const rng = new Rng(seed);
  const s = makeState(level);
  let moves = 0;
  for (; moves < cap; moves++) {
    if (won(level, s)) return { result: 'win', moves };
    const legal = legalMoves(level, s);
    if (!legal.length) return { result: 'stuck', moves };
    const exits = legal.filter((mv) => mv.exit);
    let move: Move;
    if (exits.length) {
      move = exits[0];
    } else {
      let helpful: Move | null = null;
      for (const mv of legal) {
        const n = cloneState(s);
        applyMove(level, n, mv);
        if (takeFreeExits(level, n) > 0) {
          helpful = mv;
          break;
        }
      }
      move = helpful ?? rng.pick(legal);
    }
    applyMove(level, s, move);
  }
  return { result: won(level, s) ? 'win' : 'cap', moves };
}

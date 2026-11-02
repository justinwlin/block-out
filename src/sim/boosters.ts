// Boosters change the tray. The clock only freezes the HUD timer; it has no
// puzzle state. Destroying a brick counts as a clear, so ice, locks and
// shutters still advance. Hidden bricks stay hidden.

import { pieceActive } from './rules';
import type { Level, SimState } from './types';

export function destroyPiece(level: Level, s: SimState, i: number): boolean {
  if (!pieceActive(level, s, i)) return false;
  s.out[i] = 1;
  s.clears++;
  s.keys += level.pieces[i].keys;
  return true;
}

export function destroyColor(level: Level, s: SimState, color: number): number {
  let n = 0;
  for (let i = 0; i < level.pieces.length; i++) {
    if (level.pieces[i].color !== color) continue;
    if (destroyPiece(level, s, i)) n++;
  }
  return n;
}

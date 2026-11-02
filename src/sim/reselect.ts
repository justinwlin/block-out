// Hardest start in the same tray. Slides are reversible, so every position the bricks
// can slide into (without exits or paint) is an equally valid start. Search that space
// and return the positions most likely to need real planning: nothing can leave, nothing
// is one slide from leaving, and bricks sit off their gate lines. The generator then
// solves the best few and keeps whichever start measures deepest.

import { exitOpen, oneSlideFromExit } from './depth';
import { applyMove, cloneState, dirAllowed, fitsGate, legalMoves, makeState, stateKey } from './rules';
import { SHAPES } from './shapes';
import type { Level, SimState } from './types';

export interface Start {
  x: Int16Array;
  y: Int16Array;
}

/** Bricks still to place that are not lined up with any gate of their color they may move toward. */
function offLine(level: Level, s: SimState): number {
  let n = 0;
  for (let i = 0; i < level.pieces.length; i++) {
    if (s.out[i]) continue;
    const lined = level.gates.some((g) => g.color === s.color[i] && dirAllowed(level, i, g.dir) && fitsGate(g, level.pieces[i].shape, s.x[i], s.y[i]));
    if (!lined) n++;
  }
  return n;
}

function onPaint(level: Level, s: SimState, i: number): boolean {
  if (!level.paint?.length) return false;
  const cells = SHAPES[level.pieces[i].shape].cells;
  return level.paint.some((t) => cells.some(([dx, dy]) => s.x[i] + dx === t.x && s.y[i] + dy === t.y));
}

export function hardStarts(level: Level, cap = 2500, take = 4): Start[] {
  const start = makeState(level);
  const seen = new Set<string>([stateKey(start)]);
  const states: { s: SimState; dist: number }[] = [{ s: start, dist: 0 }];
  for (let head = 0; head < states.length && states.length < cap; head++) {
    const { s, dist } = states[head];
    for (const m of legalMoves(level, s)) {
      if (m.exit) continue;
      const next = cloneState(s);
      applyMove(level, next, m);
      // A paint stop changes a color and cannot be undone; a start on paint would also hide the tile.
      if (onPaint(level, next, m.i)) continue;
      const k = stateKey(next);
      if (seen.has(k)) continue;
      seen.add(k);
      states.push({ s: next, dist: dist + 1 });
      if (states.length >= cap) break;
    }
  }
  // Cheap filter first, then the costlier one-slide check on the survivors.
  const ranked = states
    .slice(1)
    .filter(({ s }) => !exitOpen(level, s))
    .map(({ s, dist }) => ({ s, score: offLine(level, s) * 3 + Math.min(dist, 12) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, take * 4);
  const deep = ranked.filter(({ s }) => !oneSlideFromExit(level, s));
  const pick = (deep.length >= take ? deep : deep.concat(ranked.filter((r) => !deep.includes(r)))).slice(0, take);
  return pick.map(({ s }) => ({ x: s.x.slice(), y: s.y.slice() }));
}

/** A copy of the level with bricks moved to a new start. */
export function withStart(level: Level, start: Start): Level {
  return { ...level, pieces: level.pieces.map((p, i) => ({ ...p, x: start.x[i], y: start.y[i] })) };
}

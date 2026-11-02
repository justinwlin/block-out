// Forward solver. Free exits are taken at once (they only help), then A*
// searches the setup slides. Heuristic = bricks still out on the tray.

import { analyze, applyMove, canMove, cloneState, legalMoves, makeState, occupancy, stateKey, takeFreeExits, won } from './rules';
import { SHAPES } from './shapes';
import { type Dir, type Level, type Move, type SimState } from './types';

export interface SolveResult {
  solved: boolean;
  moves: Move[];
  minMoves: number;
  nodes: number;
  branching: number;
  forcedOrderings: number;
  setups: number;
  /** True when A* exhausted the cheaper branches, so minMoves is a minimum. */
  optimal: boolean;
}

interface Node {
  s: SimState;
  g: number;
  parent: number;
  edge: Move[];
}

class Heap {
  private a: { f: number; g: number; i: number }[] = [];
  get size() {
    return this.a.length;
  }
  push(f: number, g: number, i: number) {
    const a = this.a;
    a.push({ f, g, i });
    let n = a.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (a[p].f < a[n].f || (a[p].f === a[n].f && a[p].g <= a[n].g)) break;
      [a[p], a[n]] = [a[n], a[p]];
      n = p;
    }
  }
  pop(): { f: number; g: number; i: number } | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let n = 0;
      for (;;) {
        const l = n * 2 + 1;
        const r = l + 1;
        let m = n;
        if (l < a.length && (a[l].f < a[m].f || (a[l].f === a[m].f && a[l].g < a[m].g))) m = l;
        if (r < a.length && (a[r].f < a[m].f || (a[r].f === a[m].f && a[r].g < a[m].g))) m = r;
        if (m === n) break;
        [a[n], a[m]] = [a[m], a[n]];
        n = m;
      }
    }
    return top;
  }
}

/**
 * Setup slides the search is allowed to try. Every maximal slide, plus any
 * shorter one that lines the brick up with a gate. That is the Rush Hour
 * macro-move set with the extra stops this ruleset needs for a fit.
 */
function setupSlides(level: Level, s: SimState): Move[] {
  const occ = occupancy(level, s);
  const moves: Move[] = [];
  for (let i = 0; i < level.pieces.length; i++) {
    if (!canMove(level, s, i)) continue;
    const shape = SHAPES[level.pieces[i].shape];
    for (let dir = 0 as Dir; dir < 4; dir++) {
      const a = analyze(level, s, occ, i, dir);
      if (a.max < 1) continue;
      const dists = new Set<number>([a.max]);
      if (dir === 1 || dir === 3) {
        for (const g of level.gates) {
          if (g.color !== level.pieces[i].color || g.span !== shape.w) continue;
          if (g.dir !== 0 && g.dir !== 2) continue;
          const delta = g.along - s.x[i];
          const dist = dir === 1 ? delta : -delta;
          if (dist >= 1 && dist <= a.max) dists.add(dist);
        }
      } else {
        for (const g of level.gates) {
          if (g.color !== level.pieces[i].color || g.span !== shape.h) continue;
          if (g.dir !== 1 && g.dir !== 3) continue;
          const delta = g.along - s.y[i];
          const dist = dir === 2 ? delta : -delta;
          if (dist >= 1 && dist <= a.max) dists.add(dist);
        }
      }
      for (const dist of dists) moves.push({ i, dir, dist, exit: false });
    }
  }
  return moves;
}

/** Bounded beam over setup slides. Finds a solution without proving it shortest. */
export function beamSolve(level: Level, width = 36): SolveResult | null {
  const prefix: Move[] = [];
  const start = makeState(level);
  takeFreeExits(level, start, prefix);
  if (won(level, start)) return finish(level, prefix, 1);
  let layer: { s: SimState; moves: Move[] }[] = [{ s: start, moves: [...prefix] }];
  const seen = new Set<bigint>([stateKey(start)]);
  for (let depth = 0; depth < 7 && layer.length; depth++) {
    const next: { s: SimState; moves: Move[]; left: number }[] = [];
    for (const node of layer) {
      for (const slide of setupSlides(level, node.s)) {
        const s2 = cloneState(node.s);
        const edge: Move[] = [slide];
        applyMove(level, s2, slide);
        takeFreeExits(level, s2, edge);
        const k = stateKey(s2);
        if (seen.has(k)) continue;
        seen.add(k);
        const moves = node.moves.concat(edge);
        if (won(level, s2)) return { ...finish(level, moves, seen.size), optimal: false };
        next.push({ s: s2, moves, left: remaining(s2) });
      }
    }
    next.sort((a, b) => a.left - b.left || a.moves.length - b.moves.length);
    layer = next.slice(0, width).map(({ s, moves }) => ({ s, moves }));
  }
  return null;
}

function remaining(s: SimState): number {
  let n = 0;
  for (let i = 0; i < s.out.length; i++) if (!s.out[i]) n++;
  return n;
}

function pathOf(nodes: Node[], goal: number, prefix: Move[]): Move[] {
  const edges: Move[][] = [];
  for (let i = goal; i >= 0; i = nodes[i].parent) edges.push(nodes[i].edge);
  edges.reverse();
  return prefix.concat(...edges);
}

export function solve(level: Level, nodeLimit = 4000, timeLimitMs = 30): SolveResult {
  const empty: SolveResult = { solved: false, moves: [], minMoves: 0, nodes: 0, branching: 0, forcedOrderings: 0, setups: 0, optimal: false };
  const prefix: Move[] = [];
  const start = makeState(level);
  takeFreeExits(level, start, prefix);
  if (won(level, start)) return finish(level, prefix, 1);

  const nodes: Node[] = [{ s: start, g: prefix.length, parent: -1, edge: [] }];
  const best = new Map<bigint, number>();
  best.set(stateKey(start), prefix.length);
  const heap = new Heap();
  heap.push(prefix.length + remaining(start), prefix.length, 0);
  const closed = new Set<bigint>();
  let expanded = 0;
  let goalId = -1;
  let goalG = Infinity;
  let proved = false;
  const started = performance.now();

  while (heap.size) {
    const item = heap.pop()!;
    if (item.f >= goalG) {
      proved = true;
      break;
    }
    const node = nodes[item.i];
    const key = stateKey(node.s);
    if (item.g !== best.get(key)) continue;
    if (closed.has(key)) continue;
    closed.add(key);
    expanded++;
    if (expanded > nodeLimit || performance.now() - started > timeLimitMs) break;

    const moves = setupSlides(level, node.s);
    for (const slide of moves) {
      const next = cloneState(node.s);
      const edge: Move[] = [slide];
      applyMove(level, next, slide);
      takeFreeExits(level, next, edge);
      const g = node.g + edge.length;
      if (g >= goalG) continue;
      const k = stateKey(next);
      const prev = best.get(k);
      if (prev !== undefined && prev <= g) continue;
      best.set(k, g);
      const id = nodes.length;
      nodes.push({ s: next, g, parent: item.i, edge });
      if (won(level, next)) {
        goalId = id;
        goalG = g;
        continue;
      }
      heap.push(g + remaining(next), g, id);
    }
  }
  if (goalId >= 0) return { ...finish(level, pathOf(nodes, goalId, prefix), expanded), optimal: proved };
  return { ...empty, nodes: expanded };
}

function finish(level: Level, moves: Move[], nodes: number): SolveResult {
  const stats = walk(level, moves);
  const pieces = level.pieces.length;
  return {
    solved: true,
    moves,
    minMoves: moves.length,
    nodes,
    branching: stats.branching,
    forcedOrderings: stats.forced,
    setups: Math.max(0, moves.length - pieces),
    optimal: true,
  };
}

function walk(level: Level, moves: readonly Move[]): { branching: number; forced: number } {
  const s = makeState(level);
  let legalSum = 0;
  let forced = 0;
  let steps = 0;
  for (const move of moves) {
    const legal = legalMoves(level, s);
    legalSum += legal.length;
    steps++;
    const exiters = new Set(legal.filter((m) => m.exit).map((m) => m.i));
    if (legal.length === 1 || (exiters.size === 1 && move.exit)) forced++;
    applyMove(level, s, move);
  }
  return { branching: steps ? legalSum / steps : 0, forced };
}

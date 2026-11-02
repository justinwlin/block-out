// Forward solver. Free exits are taken at once (they only help), then A*
// searches the setup slides. Heuristic: bricks left, plus one for each brick off any gate line.

import { analyze, applyMove, canMove, cloneState, dirAllowed, exitLimited, fitsGate, legalMoves, makeState, occupancy, stateKey, stranded, takeFreeExits, won } from './rules';
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
  /** Unsolved and every reachable position was searched: a proven dead end. */
  exhausted?: boolean;
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
 * macro-move set with the extra stops this ruleset needs for a fit or a paint tile.
 */
function setupSlides(level: Level, s: SimState): Move[] {
  const occ = occupancy(level, s);
  const moves: Move[] = [];
  for (let i = 0; i < level.pieces.length; i++) {
    if (!canMove(level, s, i)) continue;
    const shape = SHAPES[level.pieces[i].shape];
    for (let dir = 0 as Dir; dir < 4; dir++) {
      const a = analyze(level, s, occ, i, dir);
      // Exits through limited gates are never taken for free, so they are choices here.
      if (a.exitAt && exitLimited(level, s, i, dir, a.exitAt)) moves.push({ i, dir, dist: a.exitAt, exit: true });
      if (a.max < 1) continue;
      const dists = new Set<number>([a.max]);
      // Stops that put the brick anywhere inside a gate of its color it is narrow enough for.
      const horizontal = dir === 1 || dir === 3;
      for (const g of level.gates) {
        if (g.color !== s.color[i] || (g.dir === 0 || g.dir === 2) !== horizontal) continue;
        const span = horizontal ? shape.w : shape.h;
        const pos = horizontal ? s.x[i] : s.y[i];
        const sign = dir === 1 || dir === 2 ? 1 : -1;
        for (let at = g.along; at + span <= g.along + g.span; at++) {
          const dist = (at - pos) * sign;
          if (dist >= 1 && dist <= a.max) dists.add(dist);
        }
      }
      // Stops that land a cell on a paint tile, since stopping there recolors the brick.
      for (const t of level.paint ?? []) {
        for (const [dx, dy] of shape.cells) {
          const dist = dir === 1 ? t.x - (s.x[i] + dx) : dir === 3 ? s.x[i] + dx - t.x : dir === 2 ? t.y - (s.y[i] + dy) : s.y[i] + dy - t.y;
          const lined = dir === 1 || dir === 3 ? s.y[i] + dy === t.y : s.x[i] + dx === t.x;
          if (lined && dist >= 1 && dist <= a.max) dists.add(dist);
        }
      }
      for (const dist of dists) moves.push({ i, dir, dist, exit: false });
    }
  }
  return moves;
}

/** Bounded beam over setup slides. Finds a solution without proving it shortest. */
export function beamSolve(level: Level, width = 36, depthLimit = 7): SolveResult | null {
  const prefix: Move[] = [];
  const start = makeState(level);
  takeFreeExits(level, start, prefix);
  if (won(level, start)) return finish(level, prefix, 1);
  let layer: { s: SimState; moves: Move[] }[] = [{ s: start, moves: [...prefix] }];
  const seen = new Set<string>([stateKey(start)]);
  for (let depth = 0; depth < depthLimit && layer.length; depth++) {
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
        if (stranded(level, s2)) continue;
        const moves = node.moves.concat(edge);
        if (won(level, s2)) return { ...finish(level, moves, seen.size), optimal: false };
        next.push({ s: s2, moves, left: remaining(level, s2) });
      }
    }
    next.sort((a, b) => a.left - b.left || a.moves.length - b.moves.length);
    layer = next.slice(0, width).map(({ s, moves }) => ({ s, moves }));
  }
  return null;
}

/**
 * Lower bound on moves left: one exit per brick still in play, plus one slide for every
 * brick not lined up with any gate of its current color in a direction it may move.
 * A brick can only change line or color by sliding, so the bound never overshoots and
 * A* still returns shortest solutions. Ice and closed gates are ignored, which keeps it safe.
 */
function remaining(level: Level, s: SimState): number {
  let n = 0;
  for (let i = 0; i < s.out.length; i++) {
    if (s.out[i]) continue;
    n++;
    let lined = false;
    for (let g = 0; g < level.gates.length && !lined; g++) {
      const gate = level.gates[g];
      if (gate.color !== s.color[i] || !dirAllowed(level, i, gate.dir)) continue;
      if (fitsGate(gate, level.pieces[i].shape, s.x[i], s.y[i])) lined = true;
    }
    if (!lined) n++;
  }
  return n;
}

function pathOf(nodes: Node[], goal: number, prefix: Move[]): Move[] {
  const edges: Move[][] = [];
  for (let i = goal; i >= 0; i = nodes[i].parent) edges.push(nodes[i].edge);
  edges.reverse();
  return prefix.concat(...edges);
}

export function solve(level: Level, nodeLimit = 4000, timeLimitMs = 30, from?: SimState): SolveResult {
  const empty: SolveResult = { solved: false, moves: [], minMoves: 0, nodes: 0, branching: 0, forcedOrderings: 0, setups: 0, optimal: false };
  const prefix: Move[] = [];
  const start = from ? cloneState(from) : makeState(level);
  takeFreeExits(level, start, prefix);
  if (won(level, start)) return from ? { ...empty, solved: true, moves: prefix, minMoves: prefix.length, optimal: true } : finish(level, prefix, 1);
  if (stranded(level, start)) return { ...empty, exhausted: true };

  const nodes: Node[] = [{ s: start, g: prefix.length, parent: -1, edge: [] }];
  const best = new Map<string, number>();
  best.set(stateKey(start), prefix.length);
  const heap = new Heap();
  heap.push(prefix.length + remaining(level, start), prefix.length, 0);
  const closed = new Set<string>();
  let expanded = 0;
  let goalId = -1;
  let goalG = Infinity;
  let proved = false;
  let cut = false;
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
    if (expanded > nodeLimit || performance.now() - started > timeLimitMs) {
      cut = true;
      break;
    }

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
      if (stranded(level, next)) continue;
      const id = nodes.length;
      nodes.push({ s: next, g, parent: item.i, edge });
      if (won(level, next)) {
        goalId = id;
        goalG = g;
        continue;
      }
      heap.push(g + remaining(level, next), g, id);
    }
  }
  if (goalId >= 0) {
    const moves = pathOf(nodes, goalId, prefix);
    // From a mid-game position the move stats would replay from the start, so skip them.
    if (from) return { ...empty, solved: true, moves, minMoves: moves.length, nodes: expanded, optimal: proved };
    return { ...finish(level, moves, expanded), optimal: proved };
  }
  return { ...empty, nodes: expanded, exhausted: !cut };
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

import type { Shape } from './types';

function normalize(cells: readonly (readonly [number, number])[]): [number, number][] {
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - minX, y - minY] as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

function rotations(name: string, cells: readonly (readonly [number, number])[], minLevel: number): Shape[] {
  const out: Shape[] = [];
  const seen = new Set<string>();
  let cur = cells.map((c) => [c[0], c[1]] as [number, number]);
  for (let r = 0; r < 4; r++) {
    const n = normalize(cur);
    const key = n.map((c) => c.join(',')).join(';');
    if (!seen.has(key)) {
      seen.add(key);
      out.push({
        name: out.length ? `${name}-${out.length}` : name,
        cells: n,
        w: Math.max(...n.map((c) => c[0])) + 1,
        h: Math.max(...n.map((c) => c[1])) + 1,
        minLevel,
      });
    }
    cur = cur.map(([x, y]) => [y, -x]);
  }
  return out;
}

export const SHAPES: readonly Shape[] = [
  ...rotations('dot', [[0, 0]], 1),
  ...rotations('bar2', [[0, 0], [1, 0]], 3),
  ...rotations('bar3', [[0, 0], [1, 0], [2, 0]], 6),
  ...rotations('box', [[0, 0], [1, 0], [0, 1], [1, 1]], 8),
  ...rotations('L', [[0, 0], [0, 1], [1, 1]], 10),
  ...rotations('T', [[0, 0], [1, 0], [2, 0], [1, 1]], 14),
  ...rotations('S', [[1, 0], [2, 0], [0, 1], [1, 1]], 18),
  ...rotations('plus', [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], 26),
];

export const DOT = 0;

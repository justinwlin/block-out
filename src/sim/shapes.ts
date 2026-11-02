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
  ...rotations('bar2', [[0, 0], [1, 0]], 1),
  ...rotations('bar3', [[0, 0], [1, 0], [2, 0]], 2),
  ...rotations('box', [[0, 0], [1, 0], [0, 1], [1, 1]], 3),
  ...rotations('L', [[0, 0], [0, 1], [1, 1]], 4),
  ...rotations('T', [[0, 0], [1, 0], [2, 0], [1, 1]], 7),
  ...rotations('S', [[1, 0], [2, 0], [0, 1], [1, 1]], 10),
  ...rotations('plus', [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], 18),
  // Added in generator v2. Appended so existing shape ids keep their meaning.
  ...rotations('J', [[1, 0], [1, 1], [0, 1]], 5),
  ...rotations('bar4', [[0, 0], [1, 0], [2, 0], [3, 0]], 9),
  ...rotations('Z', [[0, 0], [1, 0], [1, 1], [2, 1]], 11),
  ...rotations('bigL', [[0, 0], [0, 1], [0, 2], [1, 2]], 12),
  ...rotations('bigJ', [[1, 0], [1, 1], [1, 2], [0, 2]], 13),
  ...rotations('slab', [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]], 15),
];

export const DOT = 0;

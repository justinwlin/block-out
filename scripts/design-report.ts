// Level design report. Usage:
//   npx tsx scripts/design-report.ts [from] [to]      banded depth summary
//   npx tsx scripts/design-report.ts show <n>         draw level n and its shortest solution
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { depthOf } from '../src/sim/depth';
import { difficultyScore } from '../src/sim/economy';
import { generateBuilt } from '../src/sim/levelgen';
import { applyMove, makeState } from '../src/sim/rules';
import { SHAPES } from '../src/sim/shapes';
import { solve } from '../src/sim/solver';
import { COLORS, type Level, type SimState } from '../src/sim/types';

const LETTER = 'abcdefghijklmnopqrstuvwxyz';
const COLOR = COLORS.map((c) => c.id[0].toUpperCase());

/** Text board. Bricks are letters (uppercase = color initial on the legend), # wall, ~ shutter, gates on the rim. */
export function draw(level: Level, s: SimState): string {
  const { w, h } = level;
  const grid: string[][] = Array.from({ length: h + 2 }, () => Array(w + 2).fill(' '));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid[y + 1][x + 1] = level.floor[y * w + x] ? '.' : '#';
  for (const r of level.rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid[y + 1][x + 1] = '~';
  for (const t of level.paint ?? []) grid[t.y + 1][t.x + 1] = '*';
  level.pieces.forEach((p, i) => {
    if (s.out[i]) return;
    for (const [dx, dy] of SHAPES[p.shape].cells) grid[s.y[i] + dy + 1][s.x[i] + dx + 1] = LETTER[i];
  });
  for (const g of level.gates) {
    const mark = COLOR[g.color].toLowerCase() === COLOR[g.color] ? COLOR[g.color] : COLOR[g.color];
    for (let k = 0; k < g.span; k++) {
      if (g.dir === 0) grid[0][g.along + k + 1] = mark;
      if (g.dir === 2) grid[h + 1][g.along + k + 1] = mark;
      if (g.dir === 3) grid[g.along + k + 1][0] = mark;
      if (g.dir === 1) grid[g.along + k + 1][w + 1] = mark;
    }
  }
  const legend = level.pieces
    .map((p, i) => (s.out[i] ? '' : `${LETTER[i]}=${COLOR[s.color[i]]}${p.ice ? ` ice${p.ice}` : ''}${p.lock ? ` lock${p.lock}` : ''}${p.keys ? ' key' : ''}${p.axis ? (p.axis === 1 ? ' ↔' : ' ↕') : ''}`))
    .filter(Boolean)
    .join('  ');
  const gates = level.gates.map((g) => `${'NESW'[g.dir]}${g.along}:${COLOR[g.color]}${g.span > 1 ? `x${g.span}` : ''}${g.ice ? ` ice${g.ice}` : ''}${g.uses ? ` uses${g.uses}` : ''}`).join('  ');
  return grid.map((r) => r.join('')).join('\n') + `\n${legend}\ngates ${gates}`;
}

const DIRS = ['up', 'right', 'down', 'left'];

if (process.argv[2] === 'show') {
  const n = Number(process.argv[3]);
  const { level } = generateBuilt(n);
  const sol = solve(level, 60000, Infinity);
  const d = depthOf(level, sol.moves);
  console.log(`level ${n} ${level.variant} ${level.label} pieces=${level.pieces.length} min=${sol.minMoves} setups=${sol.setups} deep=${d.deep} chain=${d.maxChain} greedy=${d.greedyWins.toFixed(2)} traps=${level.metrics.traps ?? 0}`);
  const s = makeState(level);
  console.log(draw(level, s));
  console.log(sol.moves.map((m) => `${LETTER[m.i]}${m.exit ? ' OUT ' : ' '}${DIRS[m.dir]}${m.exit ? '' : ` ${m.dist}`}`).join(', '));
  if (process.argv.includes('--steps')) {
    for (const m of sol.moves) {
      applyMove(level, s, m);
      console.log(`\n${LETTER[m.i]} ${m.exit ? 'exits' : 'slides'} ${DIRS[m.dir]}\n${draw(level, s)}`);
    }
  }
} else if (process.argv[2] === 'rows') {
  // Worker mode: measure levels a..b and print one JSON row per level.
  const [a, b] = [Number(process.argv[3]), Number(process.argv[4])];
  for (let n = a; n <= b; n++) {
    const t = performance.now();
    const { level } = generateBuilt(n);
    const ms = performance.now() - t;
    const sol = solve(level, 30000, Infinity);
    const d = depthOf(level, sol.solved ? sol.moves : []);
    console.log(JSON.stringify({ n, variant: level.label === 'Warmup' ? 'warmup' : level.variant, breather: level.label === 'Warmup', fallback: level.fallback, deep: d.deep, chain: d.maxChain, greedy: d.greedyWins, shuffles: d.shuffles, min: sol.minMoves, score: difficultyScore(level.metrics), ms }));
  }
} else {
  const from = Number(process.argv[2] ?? 1);
  const to = Number(process.argv[3] ?? 200);
  // Interleaved shards on every core: level n goes to shard n % jobs, so each shard gets a mix.
  const jobs = Math.max(1, Math.min(availableParallelism() - 1, to - from + 1));
  type Row = { n: number; variant: string; breather: boolean; fallback: boolean; shuffles: number; deep: number; chain: number; greedy: number; min: number; score: number; ms: number };
  const chunks: [number, number][] = [];
  const size = Math.ceil((to - from + 1) / (jobs * 4));
  for (let a = from; a <= to; a += size) chunks.push([a, Math.min(to, a + size - 1)]);
  const rows: Row[] = [];
  const run = (a: number, b: number) =>
    new Promise<void>((done) => {
      const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), 'rows', String(a), String(b)], { stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
      let buf = '';
      child.stdout.on('data', (d) => (buf += d));
      child.on('close', () => {
        for (const line of buf.split('\n')) if (line.startsWith('{')) rows.push(JSON.parse(line));
        done();
      });
    });
  const queue = chunks.slice();
  await Promise.all(Array.from({ length: jobs }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) await run(c[0], c[1]);
  }));
  rows.sort((x, y) => x.n - y.n);
  const bands = [[1, 20], [21, 50], [51, 100], [101, 200], [201, 300], [301, 500]].filter(([lo, hi]) => hi >= from && lo <= to);
  const avg = (rs: typeof rows, k: 'deep' | 'chain' | 'greedy' | 'min' | 'score' | 'ms' | 'shuffles') => rs.reduce((a, r) => a + r[k], 0) / rs.length;
  console.log('band       n  greedy  shallow  deep  chain   min  score  gen-ms(p95)');
  for (const [lo, hi] of bands) {
    const b = rows.filter((r) => r.n >= lo && r.n <= hi);
    if (!b.length) continue;
    const ms = b.map((r) => r.ms).sort((x, y) => x - y);
    // Shallow: greedy clears it most of the time and no position needs two-slide planning.
    const shallow = b.filter((r) => r.greedy >= 0.5 && r.deep === 0).length / b.length;
    console.log(
      `${lo}-${hi}`.padEnd(9),
      String(b.length).padStart(3),
      `${Math.round(avg(b, 'greedy') * 100)}%`.padStart(7),
      `${Math.round(shallow * 100)}%`.padStart(8),
      avg(b, 'deep').toFixed(1).padStart(5),
      avg(b, 'chain').toFixed(1).padStart(6),
      avg(b, 'min').toFixed(1).padStart(5),
      avg(b, 'score').toFixed(0).padStart(6),
      `${avg(b, 'ms').toFixed(0)}(${ms[Math.floor(ms.length * 0.95)].toFixed(0)})`.padStart(12),
    );
  }
  console.log(`fallbacks ${rows.filter((r) => r.fallback).length}/${rows.length}`);
  console.log('\nby kind     n  greedy  deep  chain   min  shuffle');
  for (const v of [...new Set(rows.map((r) => r.variant))].sort()) {
    const b = rows.filter((r) => r.variant === v);
    console.log(v.padEnd(9), String(b.length).padStart(3), `${Math.round(avg(b, 'greedy') * 100)}%`.padStart(7), avg(b, 'deep').toFixed(1).padStart(5), avg(b, 'chain').toFixed(1).padStart(6), avg(b, 'min').toFixed(1).padStart(5), avg(b, 'shuffles').toFixed(1).padStart(8));
  }
}

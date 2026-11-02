// Headless playthroughs. Usage: npm run sim -- [levels]
// Writes sim-out/report.json and sim-out/report.csv, and prints a banded summary.
import { mkdirSync, writeFileSync } from 'node:fs';
import { greedyPlayout, randomPlayout } from '../src/sim/bots';
import { difficultyScore, playerSeconds } from '../src/sim/economy';
import { generateLevel } from '../src/sim/levelgen';
import { beamSolve } from '../src/sim/solver';

const levels = Number(process.argv[2] ?? 200);
const rows: Record<string, number | string | boolean>[] = [];

for (let n = 1; n <= levels; n++) {
  const level = generateLevel(n);
  const solved = beamSolve(level);
  const greedy = greedyPlayout(level, 50 + n);
  const random = randomPlayout(level, 80 + n, Math.max(24, level.pieces.length * 4));
  const need = playerSeconds(n, level.metrics);
  rows.push({
    level: n,
    variant: level.variant,
    label: level.label,
    pieces: level.metrics.pieces,
    colors: level.metrics.colors,
    obstacles: level.metrics.obstacles,
    minMoves: level.metrics.minMoves,
    optimal: solved?.optimal ?? false,
    forced: level.metrics.forcedOrderings,
    branching: level.metrics.branching,
    deadEnd: level.metrics.deadEndRatio,
    timer: level.timer,
    playerSec: Math.round(need * 10) / 10,
    margin: Math.round((1 - need / level.timer) * 100) / 100,
    solver: solved?.solved ? 'win' : 'loss',
    solverMoves: solved?.minMoves ?? '',
    greedy: greedy.result,
    greedyMoves: greedy.moves,
    random,
    fallback: level.fallback,
    score: Math.round(difficultyScore(level.metrics) * 10) / 10,
  });
}

mkdirSync('sim-out', { recursive: true });
writeFileSync('sim-out/report.json', JSON.stringify({ levels: rows }, null, 2));
const headers = Object.keys(rows[0] ?? { level: 1 });
const csv = [headers.join(',')].concat(rows.map((r) => headers.map((h) => r[h]).join(','))).join('\n');
writeFileSync('sim-out/report.csv', csv + '\n');

const bands = [
  [1, 20],
  [21, 50],
  [51, 100],
  [101, 200],
  [201, 350],
  [351, 500],
].filter(([lo]) => lo <= levels);

console.log(`levels=${levels}`);
console.log('band      n   solve  greedy random  moves  player  timer  margin  dead  score');
for (const [lo, hi] of bands) {
  const band = rows.filter((r) => Number(r.level) >= lo && Number(r.level) <= Math.min(hi, levels));
  if (!band.length) continue;
  const avg = (key: string) => band.reduce((a, r) => a + Number(r[key]), 0) / band.length;
  const rate = (key: string, win: string) => band.filter((r) => r[key] === win).length / band.length;
  const line = [
    `${lo}-${Math.min(hi, levels)}`.padEnd(8),
    String(band.length).padStart(3),
    `${Math.round(rate('solver', 'win') * 100)}%`.padStart(6),
    `${Math.round(rate('greedy', 'win') * 100)}%`.padStart(7),
    `${Math.round(rate('random', 'win') * 100)}%`.padStart(7),
    avg('minMoves').toFixed(1).padStart(6),
    `${avg('playerSec').toFixed(0)}s`.padStart(7),
    `${avg('timer').toFixed(0)}s`.padStart(6),
    avg('margin').toFixed(2).padStart(7),
    avg('deadEnd').toFixed(2).padStart(6),
    avg('score').toFixed(1).padStart(6),
  ];
  console.log(line.join(' '));
}
const fb = rows.filter((r) => r.fallback).length;
console.log(`fallbacks ${fb}/${rows.length}`);
console.log('wrote sim-out/report.json and sim-out/report.csv');

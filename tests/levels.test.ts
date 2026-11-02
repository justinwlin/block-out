import { describe, expect, it } from 'vitest';
import { replay } from '../src/sim/rules';
import { solve } from '../src/sim/solver';
import { greedyWinRate } from '../src/sim/depth';
import { difficultyScore, playerSeconds } from '../src/sim/economy';
import { clearLevelCache, generateBuilt, generateLevel, levelSignature, paramsFor } from '../src/sim/levelgen';
import { SHAPES } from '../src/sim/shapes';

// 200 levels: every variant, mechanic and difficulty step shows up well before then.
const built = Array.from({ length: 200 }, (_, i) => generateBuilt(i + 1));
const levels = built.map((b) => b.level);

function mean(ns: number[]) {
  return ns.reduce((a, b) => a + b, 0) / ns.length;
}

describe('generated levels', () => {
  it('is deterministic for a level number', () => {
    clearLevelCache();
    const a = levelSignature(generateBuilt(1).level);
    const b = levelSignature(generateBuilt(40).level);
    clearLevelCache();
    expect(levelSignature(generateBuilt(1).level)).toBe(a);
    expect(levelSignature(generateBuilt(40).level)).toBe(b);
  });

  it('replays the witness for every level', () => {
    for (const { level, witness } of built) {
      expect(replay(level, witness), `level ${level.n}`).toBe(true);
    }
  });

  it('is solved by a forward search and fits the clock', () => {
    let fallbacks = 0;
    for (const { level } of built) {
      if (level.fallback) fallbacks++;
      const found = solve(level, 60000, Infinity);
      expect(found.solved, `level ${level.n}`).toBe(true);
      expect(replay(level, found.moves), `level ${level.n} search`).toBe(true);
      expect(playerSeconds(level.n, level.metrics), `level ${level.n} clock`).toBeLessThan(level.timer);
      expect(level.timer).toBeGreaterThanOrEqual(45);
    }
    expect(fallbacks).toBeLessThanOrEqual(12);
  });

  it('is hard from level 4 and keeps climbing', () => {
    const tutorial = levels.slice(0, 3);
    const bands = [levels.slice(3, 50), levels.slice(50, 100), levels.slice(100, 200)];
    const score = (ls: typeof levels) => mean(ls.map((l) => difficultyScore(l.metrics)));
    const pieces = (ls: typeof levels) => mean(ls.map((l) => l.metrics.pieces));
    for (const band of bands) expect(score(band)).toBeGreaterThan(score(tutorial) * 2);
    expect(score(bands[2])).toBeGreaterThan(score(bands[0]));
    expect(pieces(bands[2])).toBeGreaterThan(pieces(bands[0]));
    expect(mean(bands[0].map((l) => l.metrics.minMoves))).toBeGreaterThan(15);
  });

  it('needs planning: a greedy player fails most trays past level 20', () => {
    const sample = levels.slice(20, 100);
    const greedy = mean(sample.map((l) => greedyWinRate(l, l.metrics.minMoves)));
    // The old generator sat near 0.7; the reseeded campaign measures 0.4-0.62.
    expect(greedy).toBeLessThan(0.65);
  });

  it('introduces obstacles on the way up, and breathes every tenth level', () => {
    expect(levels.filter((l) => l.n < 4).every((l) => l.pieces.every((p) => p.ice === 0))).toBe(true);
    expect(levels.some((l) => l.n >= 4 && l.n <= 10 && l.pieces.some((p) => p.ice > 0))).toBe(true);
    expect(levels.some((l) => l.n >= 5 && l.n <= 12 && l.gates.some((g) => g.ice > 0))).toBe(true);
    expect(levels.some((l) => l.n >= 7 && l.n <= 20 && l.pieces.some((p) => p.lock > 0))).toBe(true);
    expect(levels.some((l) => l.variant === 'checker')).toBe(true);
    expect(levels.some((l) => l.variant === 'U')).toBe(true);
    expect(levels.some((l) => l.variant === 'chambers')).toBe(true);
    const packed = levels.filter((l) => l.variant === 'packed' && !l.fallback);
    expect(packed.length).toBeGreaterThan(12);
    for (const l of packed) {
      const covered = l.pieces.reduce((a, p) => a + SHAPES[p.shape].cells.length, 0);
      expect(covered, `level ${l.n} packed`).toBe(l.w * l.h);
    }
    expect(levels.some((l) => l.rooms.length > 0)).toBe(true);
    expect(levels.some((l) => l.pieces.some((p) => p.axis))).toBe(true);
    expect(levels.some((l) => l.gates.some((g) => g.uses))).toBe(true);
    expect(levels.some((l) => l.paint?.length)).toBe(true);
    expect(levels.some((l) => l.mechanics.includes('pillars'))).toBe(true);
    expect(levels.some((l) => l.pieces.some((p) => p.lock > 0))).toBe(true);
    expect(levels.filter((l) => l.n % 10 === 5 && l.n % 25 !== 0).every((l) => l.label === 'Warmup')).toBe(true);
    expect(levels.filter((l) => l.n % 25 === 0).every((l) => l.label === 'Milestone')).toBe(true);
  });

  it('builds proven traps on most trap levels', () => {
    let trapLevels = 0;
    let withTrap = 0;
    for (let n = 13; n <= 140; n++) {
      if (!paramsFor(n).trap) continue;
      trapLevels++;
      const level = generateLevel(n);
      if ((level.metrics.traps ?? 0) > 0) {
        withTrap++;
        expect(level.label).toBe('Trap');
      }
    }
    expect(withTrap / trapLevels).toBeGreaterThan(0.5);
  });
});

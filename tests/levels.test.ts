import { describe, expect, it } from 'vitest';
import { replay } from '../src/sim/rules';
import { beamSolve } from '../src/sim/solver';
import { difficultyScore, playerSeconds } from '../src/sim/economy';
import { clearLevelCache, generateBuilt, levelSignature } from '../src/sim/levelgen';

const built = Array.from({ length: 500 }, (_, i) => generateBuilt(i + 1));
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
      const found = beamSolve(level);
      expect(found?.solved, `level ${level.n}`).toBe(true);
      expect(replay(level, found!.moves), `level ${level.n} search`).toBe(true);
      expect(playerSeconds(level.n, level.metrics), `level ${level.n} clock`).toBeLessThan(level.timer);
      expect(level.timer).toBeGreaterThanOrEqual(45);
      expect(level.timer).toBeLessThanOrEqual(180);
    }
    expect(fallbacks).toBeLessThanOrEqual(12);
  });

  it('gets harder across the campaign', () => {
    const bands = [
      levels.slice(0, 50),
      levels.slice(50, 150),
      levels.slice(200, 350),
      levels.slice(350, 500),
    ];
    const scores = bands.map((band) => mean(band.map((l) => difficultyScore(l.metrics))));
    const pieces = bands.map((band) => mean(band.map((l) => l.metrics.pieces)));
    const moves = bands.map((band) => mean(band.map((l) => l.metrics.minMoves)));
    const pressure = bands.map((band) => mean(band.map((l) => playerSeconds(l.n, l.metrics) / l.timer)));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    expect(pieces[3]).toBeGreaterThan(pieces[0] + 3);
    expect(moves[3]).toBeGreaterThan(moves[0] + 4);
    expect(pressure[3]).toBeGreaterThan(pressure[0]);
  });

  it('introduces obstacles on the way up, and breathes every fifth level', () => {
    expect(levels.filter((l) => l.n < 8).every((l) => l.pieces.every((p) => p.ice === 0))).toBe(true);
    expect(levels.some((l) => l.n >= 8 && l.n <= 24 && l.pieces.some((p) => p.ice > 0))).toBe(true);
    expect(levels.some((l) => l.variant === 'checker')).toBe(true);
    expect(levels.some((l) => l.variant === 'U')).toBe(true);
    expect(levels.some((l) => l.variant === 'chambers')).toBe(true);
    expect(levels.some((l) => l.rooms.length > 0)).toBe(true);
    expect(levels.some((l) => l.pieces.some((p) => p.lock > 0))).toBe(true);
    expect(levels.filter((l) => l.n % 5 === 0).every((l) => l.label === 'Warmup')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { stars, tickClock, winCoins } from '../src/sim/economy';
import { fresh, mergeSave } from '../src/game/save';

describe('timer setting', () => {
  it('does not count down or fail while the timer is off', () => {
    const held = tickClock(4, 0, 10, false);
    expect(held.failed).toBe(false);
    expect(held.timeLeft).toBe(4);

    const running = tickClock(4, 0, 1.5, true);
    expect(running.timeLeft).toBeCloseTo(2.5);
    expect(running.failed).toBe(false);

    const lost = tickClock(0.2, 0, 0.5, true);
    expect(lost.failed).toBe(true);

    const frozen = tickClock(3, 2, 0.5, true);
    expect(frozen.failed).toBe(false);
    expect(frozen.timeLeft).toBe(3);
    expect(frozen.freeze).toBeCloseTo(1.5);
  });

  it('still pays a clear, with three stars, when there is no clock', () => {
    expect(stars(60, 0, 0, true)).toBe(3);
    expect(stars(60, 0, 1, true)).toBe(1);
    expect(winCoins(4, 'Normal', 0, true)).toBeGreaterThan(0);
    expect(winCoins(4, 'Normal', 40, true)).toBe(winCoins(4, 'Normal', 0, true));
    expect(winCoins(4, 'Normal', 40, false)).toBeGreaterThan(winCoins(4, 'Normal', 40, true));
  });

  it('remembers the switch, and older saves keep the timer on', () => {
    expect(fresh().settings.timer).toBe(true);
    const off = mergeSave({ v: 1, settings: { ...fresh().settings, timer: false } });
    expect(off.settings.timer).toBe(false);
    expect(off.settings.sound).toBe(true);
    const legacy = mergeSave({ v: 1, coins: 40, unlocked: 3, settings: { sound: false, haptics: true, reduceMotion: false, symbols: true } });
    expect(legacy.settings.timer).toBe(true);
    expect(legacy.settings.sound).toBe(false);
    expect(legacy.coins).toBe(40);
    expect(legacy.unlocked).toBe(3);
  });
});

import type { Label, Metrics } from './types';

export const PRICES = { clock: 300, rocket: 600, ufo: 1200 } as const;
export const START_COINS = 900;
export const CLOCK_SECONDS = 15;

/**
 * A player who can find a shortest line, then still has to read the tray and drag.
 * Reading time grows with bricks, colors and obstacles; forced steps and traps add thought.
 */
export function reasonableSeconds(m: Metrics): number {
  const look = 3 + m.pieces * 1.15 + m.colors * 1.5 + m.obstacles * 1.35;
  const exec = m.minMoves * 1.2;
  const think = m.forcedOrderings * 1.15 + m.setups * 1.8 + m.deadEndRatio * 10;
  return look + exec + think;
}

/** Same reader, a little slower on later trays: more to look at, less slack on the clock. */
export function playerSeconds(n: number, m: Metrics): number {
  return reasonableSeconds(m) * (1 + Math.min(n, 500) / 700);
}

export function winCoins(n: number, label: Label, timeLeft: number, untimed = false): number {
  const bonus = label === 'Super Hard' ? 80 : label === 'Hard' ? 40 : label === 'Warmup' ? 15 : 0;
  const timePay = untimed ? 0 : Math.floor(Math.max(0, timeLeft)) * 2;
  return 30 + n * 4 + bonus + timePay;
}

export function stars(timer: number, timeLeft: number, boosters: number, untimed = false): 1 | 2 | 3 {
  if (boosters > 0) return 1;
  if (untimed || timeLeft >= timer * 0.4) return 3;
  return 2;
}

/** One frame of the clock. With the timer off, nothing counts down and the level cannot time out. */
export function tickClock(timeLeft: number, freeze: number, dt: number, enabled: boolean): { timeLeft: number; freeze: number; failed: boolean } {
  if (!enabled) return { timeLeft, freeze, failed: false };
  if (freeze > 0) return { timeLeft, freeze: Math.max(0, freeze - dt), failed: false };
  const next = timeLeft - dt;
  return { timeLeft: next, freeze: 0, failed: next <= 0 };
}

export function difficultyScore(m: Metrics): number {
  return m.minMoves + m.forcedOrderings * 1.25 + m.setups * 1.6 + m.deadEndRatio * 8 + m.obstacles * 0.8 + m.colors * 0.5 + m.pieces * 0.35;
}

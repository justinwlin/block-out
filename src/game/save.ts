import { START_COINS } from '../sim/economy';
import { GEN_VERSION } from '../sim/levelgen';

const KEY = 'block-out.save.v1';

export interface Settings {
  /** When false, levels have no countdown and cannot be lost on time. */
  timer: boolean;
  sound: boolean;
  haptics: boolean;
  reduceMotion: boolean;
  symbols: boolean;
}

export interface Snapshot {
  n: number;
  x: number[];
  y: number[];
  out: number[];
  timeLeft: number;
  freeze: number;
  boosters: number;
  /** Brick colors after paint, and gate pass counts. Missing in older snapshots. */
  color?: number[];
  passed?: number[];
  /** Drags made so far. */
  moves?: number;
}

export interface Save {
  v: 1;
  gen: number;
  unlocked: number;
  coins: number;
  best: Record<string, { time: number; stars: number }>;
  settings: Settings;
  snapshot: Snapshot | null;
}

export function fresh(): Save {
  return {
    v: 1,
    gen: GEN_VERSION,
    unlocked: 1,
    coins: START_COINS,
    best: {},
    settings: { timer: true, sound: true, haptics: true, reduceMotion: false, symbols: false },
    snapshot: null,
  };
}

/** Fills in anything an older save does not have. Timer defaults to on. */
export function mergeSave(p: (Omit<Partial<Save>, 'settings'> & { settings?: Partial<Settings> }) | null | undefined): Save {
  const base = fresh();
  if (!p || p.v !== 1) return base;
  return {
    ...base,
    ...p,
    settings: { ...base.settings, ...p.settings },
    best: p.best ?? {},
    snapshot: p.gen === GEN_VERSION ? (p.snapshot ?? null) : null,
    gen: GEN_VERSION,
    coins: typeof p.coins === 'number' && Number.isFinite(p.coins) ? p.coins : base.coins,
    unlocked: Math.max(1, p.unlocked || 1),
  };
}

export function load(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    return mergeSave(JSON.parse(raw) as Partial<Save>);
  } catch {
    return fresh();
  }
}

export function write(save: Save) {
  save.gen = GEN_VERSION;
  localStorage.setItem(KEY, JSON.stringify(save));
}

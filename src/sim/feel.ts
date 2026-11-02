// Pure map from a game event to juice. The renderer applies it; tests check the caps.

export interface Feel {
  shake: number;
  haptic: number | number[];
  sound: string;
  particles: number;
  squash: number;
}

const CAP = 14;

const TABLE: Record<string, Feel> = {
  grab: { shake: 0, haptic: 8, sound: 'grab', particles: 0, squash: 0.04 },
  tick: { shake: 0, haptic: 0, sound: 'tick', particles: 0, squash: 0 },
  bump: { shake: 1.4, haptic: [8, 18, 12], sound: 'bump', particles: 0, squash: 0.08 },
  exit: { shake: 5.5, haptic: [14, 28, 20], sound: 'exit', particles: 16, squash: 0.22 },
  thaw: { shake: 2.2, haptic: 12, sound: 'thaw', particles: 8, squash: 0 },
  unlock: { shake: 2.4, haptic: [10, 24, 14], sound: 'unlock', particles: 6, squash: 0 },
  room: { shake: 3.2, haptic: [12, 30, 16], sound: 'room', particles: 12, squash: 0 },
  rocket: { shake: 6, haptic: [16, 24, 20], sound: 'rocket', particles: 18, squash: 0.2 },
  ufo: { shake: 6.5, haptic: [18, 30, 18, 24], sound: 'ufo', particles: 22, squash: 0.16 },
  clock: { shake: 0.6, haptic: 10, sound: 'clock', particles: 0, squash: 0 },
  win: { shake: 8, haptic: [18, 36, 16, 36, 28], sound: 'win', particles: 28, squash: 0 },
  fail: { shake: 3, haptic: [30, 40, 36], sound: 'fail', particles: 0, squash: 0 },
  ui: { shake: 0, haptic: 6, sound: 'ui', particles: 0, squash: 0 },
};

export function feedback(event: string, reduceMotion: boolean): Feel {
  const src = TABLE[event] ?? TABLE.ui;
  if (!reduceMotion) return src;
  return { ...src, shake: 0, particles: Math.min(4, src.particles), squash: 0 };
}

export const SHAKE_CAP = CAP;

export function cappedShake(amount: number): number {
  return Math.max(0, Math.min(CAP, amount));
}

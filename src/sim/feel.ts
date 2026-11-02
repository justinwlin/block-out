// Pure map from a game event to feedback. There is no screen shake.

export interface Feel {
  shake: number;
  haptic: number | number[];
  sound: string;
  particles: number;
  squash: number;
}

const TABLE: Record<string, Feel> = {
  grab: { shake: 0, haptic: 6, sound: 'grab', particles: 0, squash: 0.05 },
  tick: { shake: 0, haptic: 0, sound: 'tick', particles: 0, squash: 0 },
  bump: { shake: 0, haptic: 8, sound: 'bump', particles: 0, squash: 0.07 },
  exit: { shake: 0, haptic: 10, sound: 'exit', particles: 4, squash: 0.1 },
  thaw: { shake: 0, haptic: 8, sound: 'thaw', particles: 3, squash: 0 },
  unlock: { shake: 0, haptic: 8, sound: 'unlock', particles: 2, squash: 0 },
  room: { shake: 0, haptic: 10, sound: 'room', particles: 4, squash: 0 },
  rocket: { shake: 0, haptic: 12, sound: 'rocket', particles: 6, squash: 0.06 },
  ufo: { shake: 0, haptic: 12, sound: 'ufo', particles: 4, squash: 0.04 },
  clock: { shake: 0, haptic: 6, sound: 'clock', particles: 0, squash: 0 },
  win: { shake: 0, haptic: 10, sound: 'win', particles: 0, squash: 0 },
  fail: { shake: 0, haptic: 14, sound: 'fail', particles: 0, squash: 0 },
  ui: { shake: 0, haptic: 5, sound: 'ui', particles: 0, squash: 0 },
};

export function feedback(event: string, reduceMotion: boolean): Feel {
  const src = TABLE[event] ?? TABLE.ui;
  if (!reduceMotion) return src;
  return { ...src, particles: 0, squash: 0 };
}

import { describe, expect, it } from 'vitest';
import { feedback, SHAKE_CAP } from '../src/sim/feel';

describe('feedback mapping', () => {
  it('makes an exit a bigger moment than a bump, and caps the shake', () => {
    const exit = feedback('exit', false);
    const bump = feedback('bump', false);
    expect(exit.shake).toBeGreaterThan(bump.shake);
    expect(exit.particles).toBeGreaterThan(8);
    expect(exit.shake).toBeLessThanOrEqual(SHAKE_CAP);
    expect(feedback('win', false).shake).toBeGreaterThan(exit.shake);
    expect(feedback('win', false).shake).toBeLessThanOrEqual(SHAKE_CAP);
  });

  it('drops shake and squash when reduce motion is on', () => {
    for (const event of ['exit', 'win', 'bump', 'room', 'rocket']) {
      const feel = feedback(event, true);
      expect(feel.shake).toBe(0);
      expect(feel.squash).toBe(0);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { feedback } from '../src/sim/feel';

const EVENTS = ['grab', 'tick', 'bump', 'exit', 'thaw', 'unlock', 'room', 'rocket', 'ufo', 'clock', 'win', 'fail', 'ui'];

describe('feedback mapping', () => {
  it('never shakes the screen', () => {
    for (const event of EVENTS) {
      expect(feedback(event, false).shake, event).toBe(0);
      expect(feedback(event, true).shake, event).toBe(0);
    }
  });

  it('keeps an exit quieter than a burst, and a win free of particles', () => {
    const exit = feedback('exit', false);
    const bump = feedback('bump', false);
    expect(exit.squash).toBeGreaterThan(bump.squash);
    expect(exit.particles).toBeLessThanOrEqual(6);
    expect(feedback('win', false).particles).toBe(0);
    expect(feedback('fail', false).particles).toBe(0);
  });

  it('drops squash and particles when reduce motion is on', () => {
    for (const event of ['exit', 'win', 'bump', 'room', 'rocket']) {
      const feel = feedback(event, true);
      expect(feel.squash).toBe(0);
      expect(feel.particles).toBe(0);
    }
  });
});
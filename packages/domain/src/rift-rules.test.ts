import { describe, it, expect } from 'vitest';
import {
  riftDeathOutcome,
  rollRiftReward,
  MAX_RIFT_DEATHS,
  RIFT_REWARD_MATERIALS,
} from './rift.js';

describe('Rift run rules (S20)', () => {
  it('revives below the death cap, fails at it', () => {
    expect(riftDeathOutcome(1)).toBe('revive');
    expect(riftDeathOutcome(MAX_RIFT_DEATHS - 1)).toBe('revive');
    expect(riftDeathOutcome(MAX_RIFT_DEATHS)).toBe('fail');
    expect(riftDeathOutcome(MAX_RIFT_DEATHS + 1)).toBe('fail');
  });

  it('grants meaningful materials', () => {
    expect(RIFT_REWARD_MATERIALS).toBeGreaterThan(0);
  });
});

describe('Rift boss reward roll', () => {
  it('always produces an item (guaranteed drop)', () => {
    // Drive the rng across the range — every seed yields a non-null item.
    for (let i = 0; i < 20; i++) {
      const seed = i / 20;
      const reward = rollRiftReward(() => seed);
      expect(reward.baseId.length).toBeGreaterThan(0);
      expect(Array.isArray(reward.affixes)).toBe(true);
    }
  });
});

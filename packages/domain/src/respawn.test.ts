import { describe, it, expect } from 'vitest';
import { respawnCost, RESPAWN_GOLD_COST, SAFE_ZONE_ID } from './respawn.js';
import { HOLD_VERIDIAN } from './zones.js';

describe('respawn economy', () => {
  it('safe zone is the town', () => {
    expect(SAFE_ZONE_ID).toBe(HOLD_VERIDIAN);
  });

  it('charges the flat cost when the player can afford it', () => {
    expect(respawnCost(100)).toBe(RESPAWN_GOLD_COST);
  });

  it('never charges more gold than the player holds', () => {
    expect(respawnCost(10)).toBe(10);
    expect(respawnCost(0)).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import {
  createResourceState,
  stepResources,
  onDamageDealt,
  spendSpirit,
  spendWrath,
  inCombat,
  COMBAT_GRACE_MS,
  SPIRIT_REGEN_OOC_PCT,
  SPIRIT_REGEN_IC_PCT,
  WRATH_DECAY_OOC_PCT,
  WRATH_GAIN_PER_DAMAGE,
  type ResourceState,
} from './resource-system.js';

function fresh(maxSpirit = 100, maxWrath = 100): ResourceState {
  return createResourceState({ maxSpirit, maxWrath });
}

describe('ResourceState — initialisation', () => {
  it('starts at full Spirit and empty Wrath', () => {
    const r = fresh();
    expect(r.spirit).toBe(100);
    expect(r.wrath).toBe(0);
  });
});

describe('inCombat', () => {
  it('returns false for a fresh player', () => {
    expect(inCombat(fresh(), 1000)).toBe(false);
  });

  it('returns true within the grace window of dealing damage', () => {
    const r = fresh();
    onDamageDealt(r, 10, 1000);
    expect(inCombat(r, 1000 + COMBAT_GRACE_MS - 1)).toBe(true);
  });

  it('returns false after the grace window passes', () => {
    const r = fresh();
    onDamageDealt(r, 10, 1000);
    expect(inCombat(r, 1000 + COMBAT_GRACE_MS + 1)).toBe(false);
  });
});

describe('stepResources — out of combat', () => {
  it('regenerates Spirit at the OOC rate', () => {
    const r = fresh();
    r.spirit = 50;
    stepResources(r, 1, 1_000_000);
    expect(r.spirit).toBeCloseTo(50 + 100 * SPIRIT_REGEN_OOC_PCT, 5);
  });

  it('decays Wrath toward zero', () => {
    const r = fresh();
    r.wrath = 50;
    stepResources(r, 1, 1_000_000);
    expect(r.wrath).toBeCloseTo(50 - 100 * WRATH_DECAY_OOC_PCT, 5);
  });

  it('caps Spirit at maxSpirit', () => {
    const r = fresh();
    r.spirit = 99;
    stepResources(r, 10, 1_000_000);
    expect(r.spirit).toBe(100);
  });

  it('clamps Wrath at zero', () => {
    const r = fresh();
    r.wrath = 0.1;
    stepResources(r, 10, 1_000_000);
    expect(r.wrath).toBe(0);
  });
});

describe('stepResources — in combat', () => {
  it('regenerates Spirit at the IC rate', () => {
    const r = fresh();
    onDamageDealt(r, 0, 1000); // mark in combat without changing wrath
    r.spirit = 50;
    stepResources(r, 1, 1100); // still in combat
    expect(r.spirit).toBeCloseTo(50 + 100 * SPIRIT_REGEN_IC_PCT, 5);
  });

  it('does not decay Wrath while in combat', () => {
    const r = fresh();
    onDamageDealt(r, 0, 1000);
    r.wrath = 50;
    stepResources(r, 1, 1100);
    expect(r.wrath).toBe(50);
  });
});

describe('onDamageDealt', () => {
  it('increases Wrath by damage × gain factor', () => {
    const r = fresh();
    onDamageDealt(r, 12, 1000);
    expect(r.wrath).toBeCloseTo(12 * WRATH_GAIN_PER_DAMAGE, 5);
  });

  it('caps Wrath at maxWrath', () => {
    const r = fresh();
    r.wrath = 95;
    onDamageDealt(r, 1000, 1000);
    expect(r.wrath).toBe(100);
  });

  it('marks the player in combat', () => {
    const r = fresh();
    onDamageDealt(r, 5, 1500);
    expect(r.lastCombatAt).toBe(1500);
  });
});

describe('spendSpirit / spendWrath', () => {
  it('spendSpirit returns false and leaves spirit alone when insufficient', () => {
    const r = fresh();
    r.spirit = 5;
    expect(spendSpirit(r, 10)).toBe(false);
    expect(r.spirit).toBe(5);
  });

  it('spendSpirit returns true and deducts on success', () => {
    const r = fresh();
    r.spirit = 30;
    expect(spendSpirit(r, 10)).toBe(true);
    expect(r.spirit).toBe(20);
  });

  it('spendWrath returns false and leaves wrath alone when insufficient', () => {
    const r = fresh();
    r.wrath = 99;
    expect(spendWrath(r, 100)).toBe(false);
    expect(r.wrath).toBe(99);
  });

  it('spendWrath returns true and deducts on success', () => {
    const r = fresh();
    r.wrath = 100;
    expect(spendWrath(r, 100)).toBe(true);
    expect(r.wrath).toBe(0);
  });
});

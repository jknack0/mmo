import { describe, it, expect } from 'vitest';
import {
  computeDerivedStats,
  baseDerivedStats,
  incomingDamageMultiplier,
  PYROMANCERS_WARD_REDUCTION,
  DEFAULT_BURN_STACK_CAP,
  type DerivedStats,
} from './stat-calculator.js';
import type { PassiveAllocation } from './passives.js';

const alloc = (...ids: string[]): PassiveAllocation =>
  Object.fromEntries(ids.map((id) => [id, 1]));

// Full linear paths (every node, gated correctly) so node coverage is exhaustive.
const ROOTS = ['embered-soul', 'inner-furnace'];
const DIRECT = [
  ...ROOTS,
  'sharpened-flame',
  'critical-heat',
  'detonation',
  'overcast',
  'annihilator',
  'flashburn',
];
const BURN = [
  ...ROOTS,
  'lingering-heat',
  'searing-touch',
  'smoldering-application',
  'combustion-engineer',
  'wildfire',
  'inferno',
];
const UTILITY = [
  ...ROOTS,
  'heat-mirage',
  'smoldering-form',
  'pyric-conduit',
  'cremator',
  'phoenix-resilience',
  'pyromancers-ward',
];

describe('baseDerivedStats', () => {
  it('is the identity loadout (no passives)', () => {
    const b = baseDerivedStats();
    expect(b.fireDamageMult).toBe(1);
    expect(b.burnDamageMult).toBe(1);
    expect(b.burnDurationMult).toBe(1);
    expect(b.critChance).toBe(0);
    expect(b.explosionDamageMult).toBe(1);
    expect(b.heavyNukeCdMult).toBe(1);
    expect(b.maxSpiritMult).toBe(1);
    expect(b.wrathGenMult).toBe(1);
    expect(b.detonatorDamagePerStackMult).toBe(1);
    expect(b.maxBurnStacks).toBe(DEFAULT_BURN_STACK_CAP);
    expect(b.flashburn).toBe(false);
    expect(b.inferno).toBe(false);
    expect(b.pyromancersWard).toBe(false);
    expect(b.flags).toEqual([]);
  });
});

describe('computeDerivedStats — empty', () => {
  it('equals base stats', () => {
    expect(computeDerivedStats({})).toEqual(baseDerivedStats());
  });
});

describe('computeDerivedStats — root nodes', () => {
  it('folds both roots additively', () => {
    const s = computeDerivedStats(alloc(...ROOTS));
    expect(s.fireDamageMult).toBeCloseTo(1.05);
    expect(s.burnDamageMult).toBeCloseTo(1.05);
    expect(s.maxSpiritMult).toBeCloseTo(1.05);
    expect(s.wrathGenMult).toBeCloseTo(1.05);
  });
});

describe('computeDerivedStats — Direct path', () => {
  it('stacks fire/crit/explosion/cd boosts', () => {
    const s = computeDerivedStats(
      alloc(...ROOTS, 'sharpened-flame', 'critical-heat', 'detonation', 'overcast')
    );
    expect(s.fireDamageMult).toBeCloseTo(1.13); // 1 + .05 + .08
    expect(s.critChance).toBeCloseTo(0.05);
    expect(s.explosionDamageMult).toBeCloseTo(1.1);
    expect(s.heavyNukeCdMult).toBeCloseTo(0.9);
  });

  it('Annihilator scales with equipped Pyro skill count, capped', () => {
    const a = alloc(...ROOTS, 'sharpened-flame', 'critical-heat', 'detonation', 'overcast', 'annihilator');
    // 3 equipped → +6%
    expect(computeDerivedStats(a, { equippedPyroSkillCount: 3 }).fireDamageMult).toBeCloseTo(1.19);
    // 6 equipped → +12% (cap)
    expect(computeDerivedStats(a, { equippedPyroSkillCount: 6 }).fireDamageMult).toBeCloseTo(1.25);
    // 10 equipped → still +12% (cap holds)
    expect(computeDerivedStats(a, { equippedPyroSkillCount: 10 }).fireDamageMult).toBeCloseTo(1.25);
  });

  it('Flashburn keystone: flag + 40% Pyro damage, no Inferno', () => {
    const s = computeDerivedStats(alloc(...DIRECT), { equippedPyroSkillCount: 6 });
    expect(s.flashburn).toBe(true);
    expect(s.inferno).toBe(false);
    // 1 + .05(embered) + .08(sharpened) + .12(annihilator@6) + .40(flashburn)
    expect(s.fireDamageMult).toBeCloseTo(1.65);
  });
});

describe('computeDerivedStats — Burn path', () => {
  it('folds burn duration, detonator scaling, and runtime flags', () => {
    const s = computeDerivedStats(alloc(...BURN));
    expect(s.burnDurationMult).toBeCloseTo(1.2);
    expect(s.detonatorDamagePerStackMult).toBeCloseTo(1.15);
    expect(s.flags).toContain('smoldering-application');
    expect(s.flags).toContain('wildfire');
  });

  it('Inferno keystone removes the Burn cap (Infinity)', () => {
    const s = computeDerivedStats(alloc(...BURN));
    expect(s.inferno).toBe(true);
    expect(s.maxBurnStacks).toBe(Infinity);
  });

  it('Searing Touch alone raises the cap by 1', () => {
    const s = computeDerivedStats(alloc(...ROOTS, 'lingering-heat', 'searing-touch'));
    expect(s.maxBurnStacks).toBe(DEFAULT_BURN_STACK_CAP + 1);
  });
});

describe('computeDerivedStats — Utility path', () => {
  it('Pyromancer\'s Ward keystone + all utility flags', () => {
    const s = computeDerivedStats(alloc(...UTILITY));
    expect(s.pyromancersWard).toBe(true);
    for (const f of [
      'heat-mirage',
      'smoldering-form',
      'pyric-conduit',
      'cremator',
      'phoenix-resilience',
    ]) {
      expect(s.flags).toContain(f);
    }
  });
});

describe('incomingDamageMultiplier — Pyromancer\'s Ward', () => {
  it('reduces incoming damage 20% with Ward + a burning enemy nearby', () => {
    const s = computeDerivedStats(alloc(...UTILITY));
    expect(incomingDamageMultiplier(s, true)).toBeCloseTo(1 - PYROMANCERS_WARD_REDUCTION);
  });

  it('no reduction with Ward but no burning enemy nearby', () => {
    const s = computeDerivedStats(alloc(...UTILITY));
    expect(incomingDamageMultiplier(s, false)).toBe(1);
  });

  it('no reduction without the Ward keystone', () => {
    const s = computeDerivedStats(alloc(...ROOTS));
    expect(incomingDamageMultiplier(s, true)).toBe(1);
  });
});

describe('computeDerivedStats — purity', () => {
  it('does not mutate the input allocation', () => {
    const a = alloc(...ROOTS);
    const snapshot = JSON.stringify(a);
    computeDerivedStats(a);
    expect(JSON.stringify(a)).toBe(snapshot);
  });

  it('returns a fresh flags array each call', () => {
    const s1: DerivedStats = computeDerivedStats(alloc(...BURN));
    const s2: DerivedStats = computeDerivedStats(alloc(...BURN));
    expect(s1.flags).not.toBe(s2.flags);
  });
});

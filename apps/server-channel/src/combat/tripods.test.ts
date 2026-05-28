import { describe, it, expect } from 'vitest';
import { SKILL_DEFS } from './combat-system.js';
import {
  PYROMANCY_TRIPODS,
  applyTripod,
  type PlayerTripodSelection,
} from './tripods.js';

const PYRO_SKILL_IDS = [
  'ember-step',
  'spark',
  'cinder-spray',
  'heat-wave',
  'fireball',
  'flame-lance',
  'combust',
  'meteor',
  'firestorm',
  'wall-of-flame',
  'pyroclasm',
  'cataclysm',
];

describe('PYROMANCY_TRIPODS coverage', () => {
  it('defines a tripod set for every Pyromancy skill', () => {
    for (const id of PYRO_SKILL_IDS) {
      expect(PYROMANCY_TRIPODS[id]).toBeDefined();
    }
  });

  it('every tier has exactly 3 choices', () => {
    for (const id of PYRO_SKILL_IDS) {
      const t = PYROMANCY_TRIPODS[id]!;
      expect(t.t1).toHaveLength(3);
      expect(t.t2).toHaveLength(3);
    }
  });

  it('every Tier 2 choice tags an archetype lean', () => {
    const leans: Record<string, number> = { burn: 0, direct: 0, utility: 0 };
    for (const id of PYRO_SKILL_IDS) {
      for (const c of PYROMANCY_TRIPODS[id]!.t2) {
        expect(c.archetype).toMatch(/^(burn|direct|utility)$/);
        leans[c.archetype!]++;
      }
    }
    // 12 skills × 3 choices = 36 leans across burn/direct/utility.
    expect(leans.burn + leans.direct + leans.utility).toBe(36);
  });
});

describe('applyTripod — numerical transforms', () => {
  it('multiplies damage when dmgMult is set', () => {
    const base = SKILL_DEFS.fireball!;
    const sel: PlayerTripodSelection = { t1: 0, t2: -1 };
    const result = applyTripod(base, sel, PYROMANCY_TRIPODS.fireball!);
    // Fireball T1 Concussive — +25% dmg
    expect(result.damage).toBeCloseTo(base.damage * 1.25, 3);
  });

  it('extends range when rangeMult is set', () => {
    const base = SKILL_DEFS.fireball!;
    const sel: PlayerTripodSelection = { t1: 1, t2: -1 };
    const result = applyTripod(base, sel, PYROMANCY_TRIPODS.fireball!);
    // Fireball T1 Greater Range — +50% range
    expect(result.rangeTiles).toBeCloseTo(base.rangeTiles * 1.5, 3);
  });

  it('shortens cooldown when cdMult is set', () => {
    const base = SKILL_DEFS.combust!;
    const sel: PlayerTripodSelection = { t1: 2, t2: -1 };
    const result = applyTripod(base, sel, PYROMANCY_TRIPODS.combust!);
    // Combust T1 Faster — cd 12→8s = 2/3 multiplier
    expect(result.cooldownMs).toBeLessThan(base.cooldownMs);
  });

  it('applies burn stack additions on T1 Searing-style choices', () => {
    const base = SKILL_DEFS.fireball!; // 0 burn stacks by default
    const sel: PlayerTripodSelection = { t1: 2, t2: -1 };
    const result = applyTripod(base, sel, PYROMANCY_TRIPODS.fireball!);
    // Fireball T1 Searing — applies 1 Burn
    expect(result.burnStacksApplied).toBeGreaterThan(0);
  });

  it('Flashburn-style T2 removes burn application entirely', () => {
    // Cinder Spray default applies 1 Burn. T2 Cleaving removes Burn.
    const base = SKILL_DEFS['cinder-spray']!;
    const sel: PlayerTripodSelection = { t1: -1, t2: 0 };
    const result = applyTripod(base, sel, PYROMANCY_TRIPODS['cinder-spray']!);
    expect(result.burnStacksApplied ?? 0).toBe(0);
    // Also gets +25% dmg per the spec
    expect(result.damage).toBeCloseTo(base.damage * 1.25, 3);
  });

  it('Detonate-on-Burn (Fireball T2[B]) turns the skill into a Burn detonator', () => {
    const base = SKILL_DEFS.fireball!;
    const sel: PlayerTripodSelection = { t1: -1, t2: 1 };
    const result = applyTripod(base, sel, PYROMANCY_TRIPODS.fireball!);
    expect(result.detonatesBurn).toBe(true);
    expect(result.detonateBonusPerStack).toBeGreaterThan(0);
  });

  it('compounds T1 and T2 modifiers when both are selected', () => {
    const base = SKILL_DEFS.fireball!;
    const sel: PlayerTripodSelection = { t1: 0, t2: 0 };
    const result = applyTripod(base, sel, PYROMANCY_TRIPODS.fireball!);
    // T1 Concussive +25% dmg, T2 Triple casts at 50% dmg each → 1.25 × 0.5 = 0.625
    expect(result.damage).toBeCloseTo(base.damage * 1.25 * 0.5, 3);
  });

  it('returns the base def unchanged when no selection is made', () => {
    const base = SKILL_DEFS.fireball!;
    const sel: PlayerTripodSelection = { t1: -1, t2: -1 };
    const result = applyTripod(base, sel, PYROMANCY_TRIPODS.fireball!);
    expect(result).toEqual(base);
  });
});

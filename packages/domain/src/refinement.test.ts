import { describe, it, expect } from 'vitest';
import {
  refinementMultiplier,
  refinementCap,
  tapSuccessChance,
  resolveTap,
  PITY_THRESHOLD,
} from './refinement.js';
import { aggregateEquipped } from './items.js';

describe('refinementMultiplier', () => {
  it('is 1.0 at +0 and 1.5 at +10 (+5%/level)', () => {
    expect(refinementMultiplier(0)).toBe(1);
    expect(refinementMultiplier(10)).toBeCloseTo(1.5);
    expect(refinementMultiplier(4)).toBeCloseTo(1.2);
  });
  it('never goes below 1', () => {
    expect(refinementMultiplier(-3)).toBe(1);
  });
});

describe('refinementCap', () => {
  it('rises with rarity tier', () => {
    expect(refinementCap('white')).toBe(5);
    expect(refinementCap('blue')).toBe(7);
    expect(refinementCap('yellow')).toBe(9);
    expect(refinementCap('gold')).toBe(10);
  });
});

describe('tapSuccessChance', () => {
  it('is high at low levels and declines, floored at 25%', () => {
    expect(tapSuccessChance(1)).toBeCloseTo(0.95);
    expect(tapSuccessChance(1)).toBeGreaterThan(tapSuccessChance(5));
    expect(tapSuccessChance(10)).toBeGreaterThanOrEqual(0.25);
    expect(tapSuccessChance(20)).toBe(0.25);
  });
});

describe('resolveTap', () => {
  it('success raises Refinement and resets pity', () => {
    const r = resolveTap({ refinement: 0, pityCounter: 3, cap: 5, roll: 0 });
    expect(r).toEqual({ outcome: 'success', newRefinement: 1, pityCounter: 0 });
  });

  it('failure holds Refinement and increments pity', () => {
    const r = resolveTap({ refinement: 4, pityCounter: 1, cap: 9, roll: 0.99 });
    expect(r).toEqual({ outcome: 'fail', newRefinement: 4, pityCounter: 2 });
  });

  it('capped item short-circuits with no change', () => {
    const r = resolveTap({ refinement: 5, pityCounter: 0, cap: 5, roll: 0 });
    expect(r).toEqual({ outcome: 'capped', newRefinement: 5, pityCounter: 0 });
  });

  it('pity guarantees success once the threshold is reached', () => {
    const r = resolveTap({ refinement: 8, pityCounter: PITY_THRESHOLD, cap: 10, roll: 0.999 });
    expect(r.outcome).toBe('success');
    expect(r.newRefinement).toBe(9);
    expect(r.pityCounter).toBe(0);
  });

  it('a high roll below threshold still fails', () => {
    const r = resolveTap({ refinement: 8, pityCounter: PITY_THRESHOLD - 1, cap: 10, roll: 0.999 });
    expect(r.outcome).toBe('fail');
    expect(r.pityCounter).toBe(PITY_THRESHOLD);
  });
});

describe('Refinement scales equipped stats', () => {
  it('+0 leaves base + affix stats unchanged', () => {
    const agg = aggregateEquipped([
      { baseId: 'emberfang', affixes: [], refinement: 0 }, // wd 6, int 3
    ]);
    expect(agg.weaponDamage).toBe(6);
    expect(agg.int).toBe(3);
  });

  it('+4 scales each numeric stat by 1.2 (rounded)', () => {
    const agg = aggregateEquipped([
      { baseId: 'emberfang', affixes: [], refinement: 4 },
    ]);
    expect(agg.weaponDamage).toBe(7); // round(6*1.2)=7
    expect(agg.int).toBe(4); // round(3*1.2)=4
  });

  it('+10 scales affix values too (1.5x)', () => {
    const agg = aggregateEquipped([
      {
        baseId: 'leather-vest', // base armor 5, vit 2
        affixes: [{ templateId: 'int-flat', kind: 'stat', stat: 'int', value: 10, text: '+10 Intelligence' }],
        refinement: 10,
      },
    ]);
    expect(agg.armor).toBe(8); // round(5*1.5)
    expect(agg.vit).toBe(3); // round(2*1.5)
    expect(agg.int).toBe(15); // round(10*1.5)
  });
});

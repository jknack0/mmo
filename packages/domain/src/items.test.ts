import { describe, it, expect } from 'vitest';
import {
  ITEM_BASES,
  GEAR_SLOTS,
  EQUIP_SLOTS,
  getItemBase,
  aggregateItemStats,
  emptyItemStats,
  slotAcceptsBase,
} from './items.js';

describe('ITEM_BASES catalog', () => {
  it('has unique base ids', () => {
    const ids = new Set(ITEM_BASES.map((b) => b.baseId));
    expect(ids.size).toBe(ITEM_BASES.length);
  });

  it('covers every gear slot at least once', () => {
    const slots = new Set(ITEM_BASES.map((b) => b.slot));
    for (const s of GEAR_SLOTS) expect(slots.has(s)).toBe(true);
  });

  it('every base has a known slot and non-negative stat values', () => {
    for (const b of ITEM_BASES) {
      expect(GEAR_SLOTS).toContain(b.slot);
      for (const v of Object.values(b.stats)) {
        expect(typeof v).toBe('number');
        expect(v).toBeGreaterThan(0); // white bases only carry positive flat stats
      }
    }
  });

  it('has at least one weapon and one off-hand', () => {
    expect(ITEM_BASES.some((b) => b.slot === 'weapon')).toBe(true);
    expect(ITEM_BASES.some((b) => b.slot === 'off-hand')).toBe(true);
  });
});

describe('slotAcceptsBase', () => {
  it('matches identical slots', () => {
    expect(slotAcceptsBase('chest', 'chest')).toBe(true);
    expect(slotAcceptsBase('weapon', 'weapon')).toBe(true);
  });
  it('routes a ring base into either ring position', () => {
    expect(slotAcceptsBase('ring-1', 'ring')).toBe(true);
    expect(slotAcceptsBase('ring-2', 'ring')).toBe(true);
  });
  it('rejects mismatches', () => {
    expect(slotAcceptsBase('head', 'chest')).toBe(false);
    expect(slotAcceptsBase('weapon', 'ring')).toBe(false);
  });
  it('exposes 10 equip positions', () => {
    expect(EQUIP_SLOTS.length).toBe(10);
  });
});

describe('getItemBase', () => {
  it('returns a base by id', () => {
    const sword = getItemBase('rusty-sword');
    expect(sword?.slot).toBe('weapon');
  });
  it('returns undefined for an unknown id', () => {
    expect(getItemBase('does-not-exist')).toBeUndefined();
  });
});

describe('aggregateItemStats', () => {
  it('returns all-zero for an empty list', () => {
    expect(aggregateItemStats([])).toEqual(emptyItemStats());
  });

  it('sums stats across multiple bases', () => {
    // rusty-sword {weaponDamage:5, str:2} + leather-vest {armor:5, vit:2}
    const agg = aggregateItemStats(['rusty-sword', 'leather-vest']);
    expect(agg.str).toBe(2);
    expect(agg.vit).toBe(2);
    expect(agg.weaponDamage).toBe(5);
    expect(agg.armor).toBe(5);
    expect(agg.dex).toBe(0);
    expect(agg.int).toBe(0);
  });

  it('ignores unknown base ids', () => {
    const agg = aggregateItemStats(['rusty-sword', 'ghost-item']);
    expect(agg.str).toBe(2);
    expect(agg.weaponDamage).toBe(5);
  });

  it('stacks two of the same base (e.g. two rings)', () => {
    const single = aggregateItemStats(['copper-ring']);
    const double = aggregateItemStats(['copper-ring', 'copper-ring']);
    expect(double.int).toBe(single.int * 2);
  });
});

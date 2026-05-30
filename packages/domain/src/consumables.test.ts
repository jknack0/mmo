import { describe, it, expect } from 'vitest';
import {
  CONSUMABLES,
  VENDOR_CATALOG,
  isConsumable,
  getConsumable,
  vendorEntry,
  sellValue,
} from './consumables.js';
import { computeDerivedStats, BASE_HP, HP_PER_VIT } from './stat-calculator.js';

describe('consumables catalog', () => {
  it('exposes a health potion that heals a positive amount', () => {
    const potion = getConsumable('health-potion');
    expect(potion).toBeDefined();
    expect(potion!.heal).toBeGreaterThan(0);
  });

  it('isConsumable is true for potions, false for gear', () => {
    expect(isConsumable('health-potion')).toBe(true);
    expect(isConsumable('rusty-sword')).toBe(false);
  });

  it('every consumable has a matching catalog name', () => {
    for (const c of CONSUMABLES) {
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});

describe('vendor catalog', () => {
  it('sells at least one item and one materials bundle', () => {
    expect(VENDOR_CATALOG.some((e) => e.kind === 'item')).toBe(true);
    expect(VENDOR_CATALOG.some((e) => e.kind === 'materials')).toBe(true);
  });

  it('all prices are positive integers', () => {
    for (const e of VENDOR_CATALOG) {
      expect(Number.isInteger(e.price)).toBe(true);
      expect(e.price).toBeGreaterThan(0);
    }
  });

  it('materials bundles declare a positive materialAmount', () => {
    for (const e of VENDOR_CATALOG.filter((x) => x.kind === 'materials')) {
      expect(e.materialAmount).toBeGreaterThan(0);
    }
  });

  it('vendorEntry looks up a catalog row by baseId', () => {
    const e = vendorEntry('health-potion');
    expect(e?.kind).toBe('item');
  });
});

describe('sellValue', () => {
  it('a white gear item sells for a small positive amount', () => {
    expect(sellValue('rusty-sword', 0)).toBeGreaterThan(0);
  });

  it('rarer gear sells for more than common gear', () => {
    const white = sellValue('copper-ring', 0);
    const blue = sellValue('copper-ring', 1);
    const yellow = sellValue('copper-ring', 3);
    expect(blue).toBeGreaterThan(white);
    expect(yellow).toBeGreaterThan(blue);
  });

  it('a consumable sells for less than its buy price', () => {
    const buy = vendorEntry('health-potion')!.price;
    expect(sellValue('health-potion', 0)).toBeLessThan(buy);
    expect(sellValue('health-potion', 0)).toBeGreaterThan(0);
  });
});

describe('maxHp from VIT', () => {
  it('base maxHp with no gear is BASE_HP', () => {
    const stats = computeDerivedStats({});
    expect(stats.maxHp).toBe(BASE_HP);
  });

  it('each point of equipped VIT adds HP_PER_VIT', () => {
    const stats = computeDerivedStats(
      {},
      { itemStats: { str: 0, dex: 0, int: 0, vit: 5, weaponDamage: 0, armor: 0, firePct: 0 } }
    );
    expect(stats.maxHp).toBe(BASE_HP + 5 * HP_PER_VIT);
  });
});

import { describe, it, expect } from 'vitest';
import {
  AFFIX_TEMPLATES,
  STAT_AFFIXES,
  SKILL_AFFIXES,
  getAffixTemplate,
  rollAffixValue,
  rollAffix,
  rarityForAffixCount,
  RARITY_COLOR,
  RARITY_ORDER,
} from './affixes.js';
import {
  rarityOf,
  aggregateEquipped,
  UNIQUE_BASE_IDS,
  UNIQUE_AFFIXES,
  getItemBase,
} from './items.js';

describe('affix pool', () => {
  it('splits into stat and skill templates', () => {
    expect(STAT_AFFIXES.length).toBeGreaterThan(0);
    expect(SKILL_AFFIXES.length).toBeGreaterThan(0);
    expect(STAT_AFFIXES.length + SKILL_AFFIXES.length).toBe(AFFIX_TEMPLATES.length);
  });
  it('stat affixes carry an engine stat; skill affixes do not', () => {
    for (const a of STAT_AFFIXES) expect(a.stat).toBeDefined();
    for (const a of SKILL_AFFIXES) expect(a.stat).toBeUndefined();
  });
  it('has the build-defining +Fire% affix', () => {
    expect(getAffixTemplate('fire-pct')?.stat).toBe('firePct');
  });
});

describe('rollAffixValue', () => {
  it('maps 0 to min and ~1 to max, inclusive', () => {
    const t = getAffixTemplate('str-flat')!; // 3..10
    expect(rollAffixValue(t, 0)).toBe(3);
    expect(rollAffixValue(t, 0.999999)).toBe(10);
  });
  it('rollAffix renders text and keeps value in range', () => {
    const t = getAffixTemplate('fire-pct')!; // 5..15
    const a = rollAffix(t, 0.5);
    expect(a.value).toBeGreaterThanOrEqual(5);
    expect(a.value).toBeLessThanOrEqual(15);
    expect(a.text).toContain('% Fire damage');
    expect(a.stat).toBe('firePct');
  });
});

describe('rarityForAffixCount', () => {
  it('maps counts to magic/rare bands', () => {
    expect(rarityForAffixCount(0)).toBe('white');
    expect(rarityForAffixCount(1)).toBe('blue');
    expect(rarityForAffixCount(2)).toBe('blue');
    expect(rarityForAffixCount(3)).toBe('yellow');
    expect(rarityForAffixCount(5)).toBe('yellow');
  });
});

describe('rarity colors', () => {
  it('defines a constant color for every rarity', () => {
    for (const r of RARITY_ORDER) expect(RARITY_COLOR[r]).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('uniques', () => {
  it('lists the unique bases and flags them', () => {
    expect(UNIQUE_BASE_IDS).toContain('cinderheart');
    expect(getItemBase('cinderheart')?.unique).toBe(true);
    expect(UNIQUE_AFFIXES['cinderheart']!.length).toBeGreaterThan(0);
  });
  it('rarityOf returns gold for a unique regardless of affix count', () => {
    expect(rarityOf('cinderheart', 3)).toBe('gold');
    expect(rarityOf('rusty-sword', 0)).toBe('white');
    expect(rarityOf('rusty-sword', 2)).toBe('blue');
    expect(rarityOf('rusty-sword', 4)).toBe('yellow');
  });
});

describe('aggregateEquipped', () => {
  it('folds base stats + stat affixes, ignoring skill affixes', () => {
    const agg = aggregateEquipped([
      {
        baseId: 'apprentice-wand', // base int 4, weaponDamage 3
        affixes: [
          { templateId: 'int-flat', kind: 'stat', stat: 'int', value: 6, text: '+6 Intelligence' },
          { templateId: 'fire-pct', kind: 'stat', stat: 'firePct', value: 12, text: '+12% Fire damage' },
          { templateId: 'plus-pyro-skills', kind: 'skill', value: 1, text: '+1 to Pyromancy skills' },
        ],
      },
    ]);
    expect(agg.int).toBe(10); // 4 base + 6 affix
    expect(agg.weaponDamage).toBe(3);
    expect(agg.firePct).toBe(12);
  });

  it('matches the white-only aggregate when no affixes present', () => {
    const agg = aggregateEquipped([{ baseId: 'rusty-sword', affixes: [] }]);
    expect(agg.str).toBe(2);
    expect(agg.weaponDamage).toBe(5);
    expect(agg.firePct).toBe(0);
  });
});

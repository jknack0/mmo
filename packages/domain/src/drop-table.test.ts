import { describe, it, expect } from 'vitest';
import { DROP_TABLES, rollDrop, getItemBase } from './index.js';

describe('DROP_TABLES', () => {
  it('only references real base items in every pool', () => {
    for (const table of Object.values(DROP_TABLES)) {
      for (const baseId of table.pool) {
        expect(getItemBase(baseId)).toBeDefined();
      }
      expect(table.chance).toBeGreaterThan(0);
      expect(table.chance).toBeLessThanOrEqual(1);
      expect(table.pool.length).toBeGreaterThan(0);
    }
  });
});

describe('rollDrop', () => {
  it('returns null for an unknown mob kind', () => {
    expect(rollDrop('dragon-god', 0.0)).toBeNull();
  });

  it('returns null when the roll is at/above the drop chance', () => {
    const t = DROP_TABLES['skeleton']!;
    expect(rollDrop('skeleton', t.chance)).toBeNull();
    expect(rollDrop('skeleton', 0.999)).toBeNull();
  });

  it('returns a pool item when the roll is below the drop chance', () => {
    const t = DROP_TABLES['skeleton']!;
    const dropped = rollDrop('skeleton', 0);
    expect(dropped).toBe(t.pool[0]);
    expect(getItemBase(dropped!)).toBeDefined();
  });

  it('selects across the pool deterministically by roll position', () => {
    const t = DROP_TABLES['skeleton']!;
    // roll just under chance → last pool entry
    const near = t.chance - 1e-9;
    expect(rollDrop('skeleton', near)).toBe(t.pool[t.pool.length - 1]);
    // mid roll → a middle entry
    const mid = rollDrop('skeleton', t.chance / 2);
    expect(t.pool).toContain(mid);
  });

  it('every returned drop is a valid base item', () => {
    for (let i = 0; i < 20; i++) {
      const roll = i / 20;
      const d = rollDrop('skeleton', roll);
      if (d !== null) expect(getItemBase(d)).toBeDefined();
    }
  });
});

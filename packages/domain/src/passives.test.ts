import { describe, it, expect } from 'vitest';
import {
  PASSIVE_NODES,
  PASSIVE_POOL_SIZE,
  getNode,
  validateAllocation,
  allocatableNodes,
  totalPointsSpent,
  type PassiveAllocation,
} from './passives.js';

describe('PASSIVE_NODES table', () => {
  it('has exactly 20 nodes', () => {
    expect(PASSIVE_NODES.length).toBe(20);
  });

  it('has 2 root nodes and 6 nodes per archetype path', () => {
    const byPath = (p: string) => PASSIVE_NODES.filter((n) => n.path === p);
    expect(byPath('root').length).toBe(2);
    expect(byPath('direct').length).toBe(6);
    expect(byPath('burn').length).toBe(6);
    expect(byPath('utility').length).toBe(6);
  });

  it('gives every node a unique id', () => {
    const ids = new Set(PASSIVE_NODES.map((n) => n.id));
    expect(ids.size).toBe(PASSIVE_NODES.length);
  });

  it('root nodes have no prerequisites; all path nodes have at least one', () => {
    for (const n of PASSIVE_NODES) {
      if (n.path === 'root') expect(n.prereq).toEqual([]);
      else expect(n.prereq.length).toBeGreaterThan(0);
    }
  });

  it('every prereq references a real node', () => {
    const ids = new Set(PASSIVE_NODES.map((n) => n.id));
    for (const n of PASSIVE_NODES) {
      for (const p of n.prereq) expect(ids.has(p)).toBe(true);
    }
  });

  it('has exactly 3 keystones, one terminating each path', () => {
    const keystones = PASSIVE_NODES.filter((n) =>
      n.effects.some((e) => 'kind' in e && e.kind === 'keystone')
    );
    expect(keystones.map((n) => n.id).sort()).toEqual(
      ['flashburn', 'inferno', 'pyromancers-ward'].sort()
    );
  });

  it('pool size is 20', () => {
    expect(PASSIVE_POOL_SIZE).toBe(20);
  });
});

describe('validateAllocation', () => {
  const alloc = (...ids: string[]): PassiveAllocation =>
    Object.fromEntries(ids.map((id) => [id, 1]));

  it('accepts an empty allocation', () => {
    expect(validateAllocation({})).toEqual({ ok: true });
  });

  it('accepts the two root nodes alone', () => {
    expect(validateAllocation(alloc('embered-soul', 'inner-furnace'))).toEqual({
      ok: true,
    });
  });

  it('rejects a tier-1 path node without the roots', () => {
    const r = validateAllocation(alloc('sharpened-flame'));
    expect(r).toEqual({ ok: false, error: 'prereq-not-met' });
  });

  it('accepts a tier-1 path node once both roots are allocated', () => {
    expect(
      validateAllocation(alloc('embered-soul', 'inner-furnace', 'sharpened-flame'))
    ).toEqual({ ok: true });
  });

  it('rejects skipping ahead within a path', () => {
    // detonation (tier 3) without critical-heat (tier 2)
    const r = validateAllocation(
      alloc('embered-soul', 'inner-furnace', 'sharpened-flame', 'detonation')
    );
    expect(r).toEqual({ ok: false, error: 'prereq-not-met' });
  });

  it('accepts a full linear path to a keystone in 8 points', () => {
    const path = alloc(
      'embered-soul',
      'inner-furnace',
      'sharpened-flame',
      'critical-heat',
      'detonation',
      'overcast',
      'annihilator',
      'flashburn'
    );
    expect(totalPointsSpent(path)).toBe(8);
    expect(validateAllocation(path)).toEqual({ ok: true });
  });

  it('rejects exceeding the 20-point pool', () => {
    // 21 ranks on the two roots — pool blown before prereq matters
    const over: PassiveAllocation = { 'embered-soul': 11, 'inner-furnace': 10 };
    expect(validateAllocation(over)).toEqual({ ok: false, error: 'exceeds-pool' });
  });

  it('rejects an unknown node', () => {
    expect(validateAllocation({ 'made-up-node': 1 })).toEqual({
      ok: false,
      error: 'unknown-node',
    });
  });

  it('rejects more ranks than a node allows', () => {
    expect(validateAllocation({ 'embered-soul': 2, 'inner-furnace': 1 })).toEqual({
      ok: false,
      error: 'exceeds-max-ranks',
    });
  });

  it('rejects negative or zero ranks', () => {
    expect(validateAllocation({ 'embered-soul': 0 })).toEqual({
      ok: false,
      error: 'invalid-rank',
    });
  });
});

describe('allocatableNodes', () => {
  it('offers only the two roots from an empty allocation', () => {
    expect(allocatableNodes({}).sort()).toEqual(
      ['embered-soul', 'inner-furnace'].sort()
    );
  });

  it('offers the three tier-1 path nodes once both roots are taken', () => {
    const next = allocatableNodes({ 'embered-soul': 1, 'inner-furnace': 1 });
    expect(next.sort()).toEqual(
      ['sharpened-flame', 'lingering-heat', 'heat-mirage'].sort()
    );
  });

  it('offers nothing when the pool is exhausted', () => {
    // 20 single-rank nodes = whole tree = pool spent
    const full: PassiveAllocation = Object.fromEntries(
      PASSIVE_NODES.map((n) => [n.id, 1])
    );
    expect(allocatableNodes(full)).toEqual([]);
  });
});

describe('getNode', () => {
  it('returns a node by id', () => {
    expect(getNode('flashburn')?.name).toBe('Flashburn');
  });
  it('returns undefined for unknown id', () => {
    expect(getNode('nope')).toBeUndefined();
  });
});

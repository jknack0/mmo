import { describe, it, expect } from 'vitest';
import {
  encodeClientMessage,
  decodeClientMessage,
  encodeServerMessage,
  decodeServerMessage,
  type ZoneSnapshot,
} from './index.js';

describe('pickup client message', () => {
  it('round-trips', () => {
    const decoded = decodeClientMessage(
      encodeClientMessage({ type: 'pickup', itemId: 'item-123' })
    );
    expect(decoded).toEqual({ type: 'pickup', itemId: 'item-123' });
  });

  it('rejects a malformed pickup', () => {
    expect(() => decodeClientMessage(JSON.stringify({ type: 'pickup' }))).toThrow();
  });
});

describe('picked-up server message', () => {
  it('round-trips', () => {
    const decoded = decodeServerMessage(
      encodeServerMessage({ type: 'picked-up', itemId: 'i1', baseId: 'rusty-sword' })
    );
    expect(decoded).toEqual({ type: 'picked-up', itemId: 'i1', baseId: 'rusty-sword' });
  });
});

describe('damage skillId (per-skill FX)', () => {
  it('round-trips the skillId on a damage event', () => {
    const decoded = decodeServerMessage(
      encodeServerMessage({
        type: 'damage',
        event: { targetId: 'm1', attackerId: 'p1', amount: 30, fatal: false, skillId: 'fireball' },
      })
    );
    if (decoded.type !== 'damage') throw new Error('expected damage');
    expect(decoded.event.skillId).toBe('fireball');
  });
});

describe('snapshot groundItems', () => {
  it('carries ground items through encode/decode', () => {
    const snap: ZoneSnapshot = {
      tick: 5,
      players: [],
      mobs: [],
      groundItems: [{ id: 'i1', baseId: 'copper-ring', pos: { x: 3, y: 4 }, rarity: 'white' }],
    };
    const decoded = decodeServerMessage(encodeServerMessage({ type: 'snapshot', snapshot: snap }));
    expect(decoded.type).toBe('snapshot');
    if (decoded.type !== 'snapshot') return;
    expect(decoded.snapshot.groundItems).toEqual(snap.groundItems);
  });

  it('defaults groundItems to [] for legacy snapshots', () => {
    const legacy = { type: 'snapshot', snapshot: { tick: 1, players: [], mobs: [] } };
    const decoded = decodeServerMessage(JSON.stringify(legacy));
    if (decoded.type !== 'snapshot') throw new Error('expected snapshot');
    expect(decoded.snapshot.groundItems).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  encodeClientMessage,
  decodeClientMessage,
  encodeServerMessage,
  decodeServerMessage,
  type ZoneSnapshot,
} from './index.js';

describe('use-item client message', () => {
  it('round-trips', () => {
    const decoded = decodeClientMessage(
      encodeClientMessage({ type: 'use-item', itemId: 'item-9' })
    );
    expect(decoded).toEqual({ type: 'use-item', itemId: 'item-9' });
  });

  it('rejects a malformed use-item', () => {
    expect(() => decodeClientMessage(JSON.stringify({ type: 'use-item' }))).toThrow();
  });
});

describe('consumed server message', () => {
  it('round-trips itemId + heal', () => {
    const decoded = decodeServerMessage(
      encodeServerMessage({ type: 'consumed', itemId: 'i1', heal: 50 })
    );
    expect(decoded).toEqual({ type: 'consumed', itemId: 'i1', heal: 50 });
  });
});

describe('player hp/maxHp on snapshot', () => {
  it('carries hp + maxHp through encode/decode', () => {
    const snap: ZoneSnapshot = {
      tick: 1,
      players: [
        {
          id: 'p1',
          characterId: 'c1',
          name: 'Knack',
          pos: { x: 1, y: 2 },
          engagedTargetId: null,
          spirit: 100,
          maxSpirit: 100,
          wrath: 0,
          maxWrath: 100,
          hp: 80,
          maxHp: 150,
          dead: true,
        },
      ],
      mobs: [],
      groundItems: [],
    };
    const decoded = decodeServerMessage(encodeServerMessage({ type: 'snapshot', snapshot: snap }));
    if (decoded.type !== 'snapshot') throw new Error('expected snapshot');
    expect(decoded.snapshot.players[0].hp).toBe(80);
    expect(decoded.snapshot.players[0].maxHp).toBe(150);
    expect(decoded.snapshot.players[0].dead).toBe(true);
  });
});

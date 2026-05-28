import { describe, it, expect } from 'vitest';
import {
  encodeClientMessage,
  decodeClientMessage,
  encodeServerMessage,
  decodeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from './index.js';

describe('Protocol round-trip (JSON dev mode)', () => {
  describe('ClientMessage', () => {
    it('round-trips a Hello message', () => {
      const msg: ClientMessage = {
        type: 'hello',
        sessionToken: 'sess-abc',
        characterId: 'char-123',
        name: 'Alice',
      };
      expect(decodeClientMessage(encodeClientMessage(msg))).toEqual(msg);
    });

    it('round-trips a Move message', () => {
      const msg: ClientMessage = { type: 'move', target: { x: 5, y: 7.5 } };
      expect(decodeClientMessage(encodeClientMessage(msg))).toEqual(msg);
    });

    it('round-trips an Attack message', () => {
      const msg: ClientMessage = {
        type: 'attack',
        targetId: 'skel-1',
        skillId: 'basic-attack',
      };
      expect(decodeClientMessage(encodeClientMessage(msg))).toEqual(msg);
    });

    it('throws on an Attack payload missing targetId / skillId', () => {
      expect(() =>
        decodeClientMessage(JSON.stringify({ type: 'attack' }))
      ).toThrow();
      expect(() =>
        decodeClientMessage(JSON.stringify({ type: 'attack', targetId: 'x' }))
      ).toThrow();
    });

    it('throws on a malformed payload', () => {
      expect(() => decodeClientMessage('{not json')).toThrow();
    });

    it('throws on a payload with an unknown type', () => {
      expect(() =>
        decodeClientMessage(JSON.stringify({ type: 'eat-cookie' }))
      ).toThrow();
    });

    it('throws on a Move payload missing target', () => {
      expect(() =>
        decodeClientMessage(JSON.stringify({ type: 'move' }))
      ).toThrow();
    });
  });

  describe('ServerMessage', () => {
    it('round-trips a Welcome message', () => {
      const msg: ServerMessage = {
        type: 'welcome',
        you: 'player-1',
        zoneSize: { x: 30, y: 30 },
        tileMap: [
          [0, 0, 1],
          [0, 1, 0],
        ],
      };
      expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
    });

    it('round-trips a Snapshot message with mobs', () => {
      const msg: ServerMessage = {
        type: 'snapshot',
        snapshot: {
          tick: 42,
          players: [
            { id: 'p1', characterId: 'c1', name: 'Alice', pos: { x: 10, y: 12 } },
          ],
          mobs: [
            {
              id: 'skel-1',
              kind: 'skeleton',
              pos: { x: 15, y: 15 },
              hp: 100,
              maxHp: 100,
              alive: true,
            },
          ],
        },
      };
      expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
    });

    it('round-trips a Damage event', () => {
      const msg: ServerMessage = {
        type: 'damage',
        event: {
          targetId: 'skel-1',
          attackerId: 'p1',
          amount: 12,
          fatal: false,
        },
      };
      expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
    });

    it('round-trips an Error message', () => {
      const msg: ServerMessage = { type: 'error', reason: 'invalid-token' };
      expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
    });
  });
});

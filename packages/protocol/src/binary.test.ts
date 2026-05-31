import { describe, it, expect, afterEach } from 'vitest';
import {
  encodeClientMessage,
  decodeClientMessage,
  encodeServerMessage,
  decodeServerMessage,
  setJsonProtocol,
  isJsonProtocol,
  type ClientMessage,
  type ServerMessage,
  type PlayerState,
  type MobState,
} from './index.js';
import { MAGIC_BINARY, MAGIC_JSON } from './binary.js';

afterEach(() => setJsonProtocol(false)); // never leak the dev flag between tests

function player(i: number): PlayerState {
  return {
    id: `player-uuid-0000-${i}`, characterId: `char-uuid-0000-${i}`, name: `Hero${i}`,
    pos: { x: i + 0.5, y: i * 2 + 0.25 },
    engagedTargetId: i % 2 === 0 ? null : `mob-uuid-${i}`,
    spirit: 50, maxSpirit: 100, wrath: i, maxWrath: 100, hp: 80, maxHp: 100, dead: false,
  };
}
function mob(i: number): MobState {
  // burnStacks is optional; 0 == absent on the wire, so only set it when > 0.
  const stacks = i % 3;
  return { id: `mob-uuid-0000-${i}`, kind: 'skeleton', pos: { x: i, y: i }, hp: 60, maxHp: 60, alive: true, ...(stacks ? { burnStacks: stacks } : {}) };
}
function bigSnapshot(): ServerMessage {
  return {
    type: 'snapshot',
    snapshot: {
      tick: 1234,
      players: Array.from({ length: 10 }, (_, i) => player(i)),
      mobs: Array.from({ length: 10 }, (_, i) => mob(i)),
      groundItems: [{ id: 'item-uuid-1', baseId: 'rusty-sword', pos: { x: 3.5, y: 4.5 }, rarity: 'white' }],
    },
  };
}

describe('binary protocol (S23)', () => {
  it('binary frames lead with the binary magic byte by default', () => {
    const frame = encodeServerMessage({ type: 'error', reason: 'nope' });
    expect(frame).toBeInstanceOf(Uint8Array);
    expect(frame[0]).toBe(MAGIC_BINARY);
    expect(isJsonProtocol()).toBe(false);
  });

  it('the JSON dev flag switches the encoder to a JSON frame, decoder still reads it', () => {
    setJsonProtocol(true);
    const msg: ServerMessage = { type: 'zone-transition', zoneId: 'ashen-plains' };
    const frame = encodeServerMessage(msg);
    expect(frame[0]).toBe(MAGIC_JSON);
    expect(decodeServerMessage(frame)).toEqual(msg);
  });

  it('a binary frame decodes even while the encoder is in JSON mode (interop)', () => {
    const binFrame = encodeServerMessage({ type: 'consumed', itemId: 'i1', heal: 40 });
    setJsonProtocol(true); // flip after encoding
    expect(decodeServerMessage(binFrame)).toEqual({ type: 'consumed', itemId: 'i1', heal: 40 });
  });

  it('round-trips every ServerMessage type in binary', () => {
    const msgs: ServerMessage[] = [
      { type: 'welcome', you: 'p1', zoneId: 'ashen-plains', instanceId: '', zoneSize: { x: 4, y: 3 },
        tileMap: [[1, 1, 1, 1], [1, 0, 0, 1], [1, 1, 1, 1]],
        npcs: [{ id: 'trainer-pyro', kind: 'trainer', pos: { x: 2, y: 1 }, label: 'Pyromancer' }],
        portals: [{ id: 'to-ashen', pos: { x: 1, y: 2 }, targetZoneId: 'hold-veridian', label: 'Hold' }] },
      { type: 'zone-transition', zoneId: 'rift-t1' },
      { type: 'rift-status', phase: 'mini-boss', kills: 30, quota: 30, deaths: 1, maxDeaths: 3 },
      bigSnapshot(),
      { type: 'damage', event: { targetId: 't', attackerId: 'a', amount: 12.5, fatal: true, skillId: 'fireball' } },
      { type: 'damage', event: { targetId: 't', attackerId: 'a', amount: 3, fatal: false } },
      { type: 'picked-up', itemId: 'i1', baseId: 'copper-ring' },
      { type: 'consumed', itemId: 'i1', heal: 40 },
      { type: 'error', reason: 'channel-full' },
    ];
    for (const m of msgs) expect(decodeServerMessage(encodeServerMessage(m))).toEqual(m);
  });

  it('round-trips every ClientMessage type in binary', () => {
    const msgs: ClientMessage[] = [
      { type: 'hello', sessionToken: 's', characterId: 'c', name: 'A' },
      { type: 'hello', sessionToken: 's', characterId: 'c', name: 'A', instanceId: 'rift-9' },
      { type: 'move', target: { x: 7.25, y: 9.75 } },
      { type: 'attack', targetId: 'mob-1', skillId: 'spark' },
      { type: 'dodge' },
      { type: 'pickup', itemId: 'i1' },
      { type: 'use-item', itemId: 'i2' },
    ];
    for (const m of msgs) expect(decodeClientMessage(encodeClientMessage(m))).toEqual(m);
  });

  it('binary cuts a representative snapshot to ≤50% of JSON wire bytes', () => {
    const snap = bigSnapshot();
    const binLen = encodeServerMessage(snap).length;
    setJsonProtocol(true);
    const jsonLen = encodeServerMessage(snap).length;
    expect(binLen).toBeLessThanOrEqual(jsonLen * 0.5);
  });
});

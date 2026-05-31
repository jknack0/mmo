import { describe, it, expect } from 'vitest';
import { encodeServerMessage, decodeServerMessage } from './index.js';

describe('welcome carries zone identity + npcs + portals', () => {
  it('round-trips zoneId, npcs and portals', () => {
    const decoded = decodeServerMessage(
      encodeServerMessage({
        type: 'welcome',
        you: 'p1',
        zoneId: 'hold-veridian',
        instanceId: '',
        zoneSize: { x: 30, y: 30 },
        tileMap: [[1, 1], [1, 0]],
        npcs: [{ id: 'v', kind: 'vendor', pos: { x: 12, y: 14 }, label: 'Quartermaster' }],
        portals: [{ id: 'to-ashen', pos: { x: 15, y: 26 }, targetZoneId: 'ashen-plains', label: 'Ashen Plains' }],
      })
    );
    if (decoded.type !== 'welcome') throw new Error('expected welcome');
    expect(decoded.zoneId).toBe('hold-veridian');
    expect(decoded.npcs[0]!.kind).toBe('vendor');
    expect(decoded.portals[0]!.targetZoneId).toBe('ashen-plains');
  });

  it('defaults npcs/portals to [] for a legacy welcome', () => {
    const legacy = {
      type: 'welcome',
      you: 'p1',
      zoneSize: { x: 10, y: 10 },
      tileMap: [[0]],
    };
    const decoded = decodeServerMessage(JSON.stringify(legacy));
    if (decoded.type !== 'welcome') throw new Error('expected welcome');
    expect(decoded.npcs).toEqual([]);
    expect(decoded.portals).toEqual([]);
  });
});

describe('zone-transition server message', () => {
  it('round-trips the target zone', () => {
    const decoded = decodeServerMessage(
      encodeServerMessage({ type: 'zone-transition', zoneId: 'ashen-plains' })
    );
    expect(decoded).toEqual({ type: 'zone-transition', zoneId: 'ashen-plains' });
  });

  it('rejects a malformed zone-transition', () => {
    expect(() => decodeServerMessage(JSON.stringify({ type: 'zone-transition' }))).toThrow();
  });
});

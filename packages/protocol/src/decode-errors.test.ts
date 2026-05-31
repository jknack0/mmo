import { describe, it, expect, afterEach } from 'vitest';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeServerMessage,
  setJsonProtocol,
} from './index.js';

// Coverage sweep (S27): exercise the decoder validation / error branches and the
// legacy-JSON + JSON-dev-flag envelope paths that round-trip tests don't reach.
afterEach(() => setJsonProtocol(false));

describe('decoder error paths', () => {
  it('rejects unknown and malformed client messages (legacy JSON string in)', () => {
    expect(() => decodeClientMessage('{"type":"nope"}')).toThrow(/unknown client message/);
    expect(() => decodeClientMessage('{"type":"hello"}')).toThrow(/malformed hello/);
    expect(() => decodeClientMessage('{"type":"move"}')).toThrow(/malformed move/);
    expect(() => decodeClientMessage('{"type":"attack","targetId":"x"}')).toThrow(/malformed attack/);
    expect(() => decodeClientMessage('{"type":"pickup"}')).toThrow(/malformed pickup/);
    expect(() => decodeClientMessage('{"type":"use-item"}')).toThrow(/malformed use-item/);
  });

  it('rejects unknown and malformed server messages', () => {
    expect(() => decodeServerMessage('{"type":"nope"}')).toThrow(/unknown server message/);
    expect(() => decodeServerMessage('{"type":"welcome"}')).toThrow(/malformed welcome/);
    expect(() => decodeServerMessage('{"type":"zone-transition"}')).toThrow(/malformed zone-transition/);
    expect(() => decodeServerMessage('{"type":"rift-status","phase":"x"}')).toThrow(/malformed rift-status/);
    expect(() => decodeServerMessage('{"type":"snapshot","snapshot":null}')).toThrow(/malformed snapshot/);
    expect(() => decodeServerMessage('{"type":"damage","event":{}}')).toThrow(/malformed damage/);
    expect(() => decodeServerMessage('{"type":"picked-up","itemId":"x"}')).toThrow(/malformed picked-up/);
    expect(() => decodeServerMessage('{"type":"consumed","itemId":"x"}')).toThrow(/malformed consumed/);
    expect(() => decodeServerMessage('{"type":"error"}')).toThrow(/malformed error/);
    expect(() => decodeServerMessage('{"type":"delta","delta":null}')).toThrow(/malformed delta/);
  });

  it('tolerates legacy/partial snapshots and rift-status defaults', () => {
    // snapshot without groundItems is back-filled to [].
    const snap = decodeServerMessage('{"type":"snapshot","snapshot":{"tick":1,"players":[],"mobs":[]}}');
    expect(snap).toMatchObject({ type: 'snapshot', snapshot: { groundItems: [] } });
    // rift-status without deaths/maxDeaths defaults them to 0.
    const rift = decodeServerMessage('{"type":"rift-status","phase":"clearing","kills":3,"quota":30}');
    expect(rift).toMatchObject({ type: 'rift-status', deaths: 0, maxDeaths: 0 });
  });

  it('decodes a JSON dev-flag frame and a legacy raw-JSON frame identically to binary', () => {
    const msg = { type: 'error', reason: 'x' } as const;
    // Binary frame (default).
    expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
    // JSON dev frame (magic 0x4A).
    setJsonProtocol(true);
    expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
    // Legacy raw-JSON bytes (no magic, starts with '{').
    const legacy = new TextEncoder().encode(JSON.stringify(msg));
    expect(decodeServerMessage(legacy)).toEqual(msg);
  });
});

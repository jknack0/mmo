import { describe, it, expect } from 'vitest';
import { pickChannel, capForZone, DEFAULT_ZONE_CAP, type ChannelInfo } from './pick.js';

const ch = (channelId: string, currentLoad: number): ChannelInfo => ({
  channelId,
  processUrl: `ws://localhost/${channelId}`,
  currentLoad,
});

describe('capForZone', () => {
  it('town (Hold Veridian) caps at 100', () => {
    expect(capForZone('hold-veridian')).toBe(100);
  });
  it('an open-world zone caps at the default 50', () => {
    expect(capForZone('ashen-plains')).toBe(DEFAULT_ZONE_CAP);
    expect(DEFAULT_ZONE_CAP).toBe(50);
  });
});

describe('pickChannel', () => {
  it('spawns when there are no channels yet', () => {
    expect(pickChannel([], 50)).toEqual({ kind: 'spawn' });
  });

  it('returns the only channel when it is under cap', () => {
    const c = ch('a', 10);
    expect(pickChannel([c], 50)).toEqual({ kind: 'existing', channel: c });
  });

  it('prefers the least-loaded channel', () => {
    const r = pickChannel([ch('a', 30), ch('b', 5), ch('c', 20)], 50);
    expect(r).toEqual({ kind: 'existing', channel: ch('b', 5) });
  });

  it('treats a channel at cap as full and spawns when all are full', () => {
    expect(pickChannel([ch('a', 50)], 50)).toEqual({ kind: 'spawn' });
  });

  it('cap=1: a full channel pushes the next client to a different channel', () => {
    // a is full (1/1), b has room → route to b.
    const r = pickChannel([ch('a', 1), ch('b', 0)], 1);
    expect(r).toEqual({ kind: 'existing', channel: ch('b', 0) });
  });

  it('cap=1: all channels full → spawn', () => {
    expect(pickChannel([ch('a', 1)], 1)).toEqual({ kind: 'spawn' });
  });

  it('honours a preferred channel that has room (manual switch)', () => {
    const r = pickChannel([ch('a', 10), ch('b', 2)], 50, 'a');
    expect(r).toEqual({ kind: 'existing', channel: ch('a', 10) });
  });

  it('reports preferred-full when the requested channel is at cap', () => {
    expect(pickChannel([ch('a', 50), ch('b', 0)], 50, 'a')).toEqual({ kind: 'preferred-full' });
  });

  it('falls back to normal routing when the preferred channel is unknown', () => {
    const r = pickChannel([ch('a', 3)], 50, 'ghost');
    expect(r).toEqual({ kind: 'existing', channel: ch('a', 3) });
  });
});

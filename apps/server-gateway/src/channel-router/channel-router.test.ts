import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createRedis, type RedisClient } from '../redis/client.js';
import { env } from '../env.js';
import { createChannelRouter, type ChannelRouter, type ChannelSpawner } from './channel-router.js';

describe('ChannelRouter (Redis)', () => {
  let redis: RedisClient;

  beforeAll(() => {
    redis = createRedis(env.redisUrl);
  });
  afterAll(async () => {
    await redis.quit();
  });
  beforeEach(async () => {
    await redis.flushdb();
  });

  const router = (spawner?: ChannelSpawner): ChannelRouter => createChannelRouter(redis, spawner);

  it('registers channels and lists them for a zone', async () => {
    const r = router();
    await r.registerChannel({ channelId: 'a', zoneId: 'ashen-plains', processUrl: 'ws://h/a', currentLoad: 3 });
    await r.registerChannel({ channelId: 'b', zoneId: 'ashen-plains', processUrl: 'ws://h/b', currentLoad: 0 });
    const list = await r.listChannels('ashen-plains');
    expect(list.map((c) => c.channelId).sort()).toEqual(['a', 'b']);
    expect(list.find((c) => c.channelId === 'a')!.currentLoad).toBe(3);
  });

  it('routes to the least-loaded channel', async () => {
    const r = router();
    await r.registerChannel({ channelId: 'a', zoneId: 'ashen-plains', processUrl: 'ws://h/a', currentLoad: 9 });
    await r.registerChannel({ channelId: 'b', zoneId: 'ashen-plains', processUrl: 'ws://h/b', currentLoad: 2 });
    const res = await r.routeToChannel('ashen-plains', 'acct-1');
    expect(res).toEqual({ wsUrl: 'ws://h/b', channelId: 'b' });
  });

  it('heartbeat updates currentLoad', async () => {
    const r = router();
    await r.registerChannel({ channelId: 'a', zoneId: 'ashen-plains', processUrl: 'ws://h/a', currentLoad: 0 });
    await r.heartbeat('a', 7);
    const list = await r.listChannels('ashen-plains');
    expect(list[0]!.currentLoad).toBe(7);
  });

  it('cap=1: a full channel sends the next client to a different channel', async () => {
    const r = router();
    await r.registerChannel({ channelId: 'a', zoneId: 'ashen-plains', processUrl: 'ws://h/a', currentLoad: 1 });
    await r.registerChannel({ channelId: 'b', zoneId: 'ashen-plains', processUrl: 'ws://h/b', currentLoad: 0 });
    const res = await r.routeToChannel('ashen-plains', 'acct-1', { capOverride: 1 });
    expect(res).toEqual({ wsUrl: 'ws://h/b', channelId: 'b' });
  });

  it('spins up a new channel when all are at capacity', async () => {
    let spawned = 0;
    const spawner: ChannelSpawner = async (zoneId) => {
      spawned++;
      return { channelId: 'spawned-1', processUrl: `ws://h/${zoneId}/new`, currentLoad: 0 };
    };
    const r = router(spawner);
    await r.registerChannel({ channelId: 'a', zoneId: 'ashen-plains', processUrl: 'ws://h/a', currentLoad: 1 });
    const res = await r.routeToChannel('ashen-plains', 'acct-1', { capOverride: 1 });
    expect(spawned).toBe(1);
    expect(res).toEqual({ wsUrl: 'ws://h/ashen-plains/new', channelId: 'spawned-1' });
    // The spawned channel is now registered and routable.
    const list = await r.listChannels('ashen-plains');
    expect(list.map((c) => c.channelId).sort()).toEqual(['a', 'spawned-1']);
  });

  it('returns at-capacity when full and no spawner is configured', async () => {
    const r = router();
    await r.registerChannel({ channelId: 'a', zoneId: 'ashen-plains', processUrl: 'ws://h/a', currentLoad: 1 });
    const res = await r.routeToChannel('ashen-plains', 'acct-1', { capOverride: 1 });
    expect(res).toEqual({ error: 'at-capacity' });
  });

  it('honours a manual channel switch to a specific channel', async () => {
    const r = router();
    await r.registerChannel({ channelId: 'a', zoneId: 'ashen-plains', processUrl: 'ws://h/a', currentLoad: 1 });
    await r.registerChannel({ channelId: 'b', zoneId: 'ashen-plains', processUrl: 'ws://h/b', currentLoad: 1 });
    const res = await r.routeToChannel('ashen-plains', 'acct-1', { preferred: 'a' });
    expect(res).toEqual({ wsUrl: 'ws://h/a', channelId: 'a' });
  });

  it('reports preferred-full when the requested channel is at cap', async () => {
    const r = router();
    await r.registerChannel({ channelId: 'a', zoneId: 'ashen-plains', processUrl: 'ws://h/a', currentLoad: 50 });
    const res = await r.routeToChannel('ashen-plains', 'acct-1', { preferred: 'a' });
    expect(res).toEqual({ error: 'preferred-full' });
  });

  it('zone caps differ: Hold Veridian tolerates 60 players, an open zone does not', async () => {
    const r = router();
    // 60 is over the open-world cap (50) but under the town cap (100).
    await r.registerChannel({ channelId: 'town', zoneId: 'hold-veridian', processUrl: 'ws://h/town', currentLoad: 60 });
    const res = await r.routeToChannel('hold-veridian', 'acct-1');
    expect(res).toEqual({ wsUrl: 'ws://h/town', channelId: 'town' });
  });
});

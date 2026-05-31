import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { AddressInfo } from 'node:net';
import { buildChannelServer, type ChannelServer } from '../channel-server.js';
import { runLoad } from './load-rig.js';

// Own redis db (…/6) so flushes never race the other WS suites.
const REDIS_URL = (process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1').replace(/\/\d+$/, '') + '/6';

const CAP = 50;
const SIZE = { x: 30, y: 30 };
const TILE_MAP = Array.from({ length: SIZE.y }, () => Array.from({ length: SIZE.x }, () => 0));

describe('load-test rig + 50-client validation (S25)', () => {
  let redis: Redis;
  let server: ChannelServer;
  let wsUrl: string;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL);
    await redis.flushdb();
    server = buildChannelServer({
      redis,
      zone: { size: SIZE, tileMap: TILE_MAP },
      mobs: [{ id: 'skel-1', kind: 'skeleton', pos: { x: 15, y: 15 }, maxHp: 1000, respawnMs: 1000 }],
      tickHz: 20, // the real ADR-0011 rate — validates the 20Hz budget
      capacity: CAP,
    });
    await server.start(0);
    wsUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await server.stop();
    await redis.quit();
  });

  it('sustains 50 clients at 20Hz and enforces the capacity cap', async () => {
    // 51 clients against a cap of 50: exactly one join is refused.
    const result = await runLoad({
      wsUrl, redis, clients: CAP + 1, durationMs: 1500,
      zoneSize: SIZE, inputIntervalMs: 200, combatEvery: 4,
    });

    // Capacity (ADR-0011): 50 in, 1 refused, no other connection errors.
    expect(result.welcomed).toBe(CAP);
    expect(result.channelFull).toBe(1);
    expect(result.connectionErrors).toBe(0);
    expect(result.framesReceived).toBeGreaterThan(0);

    // 20Hz tick budget held under full load.
    const stats = server.tickStats();
    expect(stats.ticks).toBeGreaterThan(10);
    expect(stats.avgMs).toBeLessThan(stats.budgetMs);        // average tick fits the budget
    expect(stats.maxMs).toBeLessThan(stats.budgetMs * 2);    // no catastrophic stall

    // Surface the baseline so a watcher / CI log captures it.
    // eslint-disable-next-line no-console
    console.log('[loadtest] baseline', JSON.stringify({
      clients: result.clients, welcomed: result.welcomed, channelFull: result.channelFull,
      gameplayErrors: result.gameplayErrors,
      tick: { ticks: stats.ticks, avgMs: +stats.avgMs.toFixed(3), maxMs: +stats.maxMs.toFixed(3), missed: stats.missed, budgetMs: stats.budgetMs },
      bandwidth: { totalKB: +(result.bytesReceived / 1024).toFixed(1), perClientBps: Math.round(result.bytesPerClientPerSecond) },
      proc: { rssMb: +result.rssMb.toFixed(1), heapUsedMb: +result.heapUsedMb.toFixed(1), cpuUserMs: +result.cpuUserMs.toFixed(0), cpuSystemMs: +result.cpuSystemMs.toFixed(0) },
    }));
  }, 15000);
});

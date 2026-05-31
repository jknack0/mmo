import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { WebSocket } from 'ws';
import Redis from 'ioredis';
import { AddressInfo } from 'node:net';
import {
  encodeClientMessage,
  decodeServerMessage,
  type ServerMessage,
} from '@mmo/protocol';
import { buildChannelServer, type ChannelServer } from './channel-server.js';

// Own redis db (…/2) so this suite's flushdb never races channel-server.test,
// which flushes db 1 and runs in a parallel worker against the same server.
const REDIS_URL =
  (process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1').replace(/\/\d+$/, '') + '/2';
const TEST_MAP = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));

function waitFor(
  ws: WebSocket,
  predicate: (m: ServerMessage) => boolean,
  timeoutMs = 2000
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('waitFor timed out')), timeoutMs);
    const handler = (data: WebSocket.RawData) => {
      let msg: ServerMessage;
      try { msg = decodeServerMessage(data.toString()); } catch { return; }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('ChannelServer capacity + heartbeat (S04)', () => {
  let redis: Redis;
  let server: ChannelServer;
  let wsUrl: string;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL);
    server = buildChannelServer({
      redis,
      zone: { size: { x: 10, y: 10 }, tileMap: TEST_MAP },
      tickHz: 50,
      zoneId: 'ashen-plains',
      channelId: 'cap-ch',
      processUrl: 'ws://cap-ch.test',
      capacity: 1,
      heartbeatMs: 100,
    });
    await server.start(0);
    wsUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await server.stop();
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  function connect(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }
  async function session(accountId: string): Promise<string> {
    const token = `tok-${Math.random().toString(36).slice(2, 10)}`;
    await redis.set(`session:${token}`, accountId, 'EX', 60);
    return token;
  }
  const hello = (ws: WebSocket, t: string, c: string, n: string) =>
    ws.send(encodeClientMessage({ type: 'hello', sessionToken: t, characterId: c, name: n }));

  it('rejects a second player when the channel is at capacity (cap=1)', async () => {
    const a = await connect();
    hello(a, await session('acct-a'), 'char-a', 'A');
    await waitFor(a, (m) => m.type === 'welcome');

    const b = await connect();
    hello(b, await session('acct-b'), 'char-b', 'B');
    const err = await waitFor(b, (m) => m.type === 'error');
    expect(err.type === 'error' && err.reason).toBe('channel-full');
    await new Promise<void>((r) => b.once('close', () => r()));

    a.close();
  });

  it('admits a new player after a slot frees up', async () => {
    const a = await connect();
    hello(a, await session('acct-a2'), 'char-a2', 'A');
    await waitFor(a, (m) => m.type === 'welcome');
    a.close();
    // Give the server a tick to process the disconnect.
    await new Promise((r) => setTimeout(r, 150));

    const b = await connect();
    hello(b, await session('acct-b2'), 'char-b2', 'B');
    const welcome = await waitFor(b, (m) => m.type === 'welcome');
    expect(welcome.type).toBe('welcome');
    b.close();
  });

  it('heartbeats its load into the routing table Redis keys', async () => {
    const a = await connect();
    hello(a, await session('acct-hb'), 'char-hb', 'HB');
    await waitFor(a, (m) => m.type === 'welcome');

    // Heartbeat (every 100ms) should publish meta with currentLoad=1.
    await new Promise((r) => setTimeout(r, 200));
    const members = await redis.smembers('channel:zone:ashen-plains');
    expect(members).toContain('cap-ch');
    const raw = await redis.get('channel:meta:cap-ch');
    expect(raw).toBeTruthy();
    const meta = JSON.parse(raw!);
    expect(meta.processUrl).toBe('ws://cap-ch.test');
    expect(meta.currentLoad).toBe(1);

    a.close();
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import Redis from 'ioredis';
import { AddressInfo } from 'node:net';
import { encodeClientMessage, decodeServerMessage, type ServerMessage } from '@mmo/protocol';
import { RIFT_T1_ZONE_ID } from '@mmo/domain';
import { buildRiftServer, type RiftServer } from './rift-server.js';

const REDIS_URL =
  (process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1').replace(/\/\d+$/, '') + '/4';

function waitFor(ws: WebSocket, type: ServerMessage['type'], timeoutMs = 3000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`waitFor ${type} timed out`)), timeoutMs);
    const handler = (data: WebSocket.RawData) => {
      let msg: ServerMessage;
      try { msg = decodeServerMessage(data.toString()); } catch { return; }
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('RiftServer (S19)', () => {
  let redis: Redis;
  let server: RiftServer;
  let wsUrl: string;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL);
    await redis.flushdb();
    server = buildRiftServer({ redis, zoneId: RIFT_T1_ZONE_ID, tickHz: 50, quota: 1 });
    await server.start(0);
    wsUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await server.stop();
    await redis.quit();
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
  const hello = (ws: WebSocket, t: string, c: string, n: string, instanceId?: string) =>
    ws.send(encodeClientMessage({ type: 'hello', sessionToken: t, characterId: c, name: n, ...(instanceId ? { instanceId } : {}) }));

  it('opens a fresh private instance and reports the wave-clear phase', async () => {
    const ws = await connect();
    // Attach both listeners before hello — welcome + rift-status arrive back-to-back.
    const welcomeP = waitFor(ws, 'welcome');
    const statusP = waitFor(ws, 'rift-status');
    hello(ws, await session('a'), 'c-a', 'A');
    const welcome = await welcomeP;
    if (welcome.type !== 'welcome') throw new Error('expected welcome');
    expect(welcome.zoneId).toBe(RIFT_T1_ZONE_ID);
    expect(welcome.instanceId).toMatch(/.+/);
    const status = await statusP;
    if (status.type !== 'rift-status') throw new Error('expected rift-status');
    expect(status.phase).toBe('wave-clear');
    ws.close();
  });

  it('two solo players get separate instances; a party shares one', async () => {
    const a = await connect();
    hello(a, await session('s1'), 'c1', 'A');
    const wa = await waitFor(a, 'welcome');
    const idA = wa.type === 'welcome' ? wa.instanceId : '';

    const b = await connect();
    hello(b, await session('s2'), 'c2', 'B');
    const wb = await waitFor(b, 'welcome');
    const idB = wb.type === 'welcome' ? wb.instanceId : '';
    expect(idB).not.toBe(idA); // private — separate instances

    const c = await connect();
    hello(c, await session('s3'), 'c3', 'C', idA); // join A's party
    const wc = await waitFor(c, 'welcome');
    const idC = wc.type === 'welcome' ? wc.instanceId : '';
    expect(idC).toBe(idA);

    a.close(); b.close(); c.close();
    await new Promise((r) => setTimeout(r, 150));
  });

  it('tears down an instance when its last member leaves', async () => {
    const ws = await connect();
    hello(ws, await session('t1'), 'ct', 'T');
    const w = await waitFor(ws, 'welcome');
    const id = w.type === 'welcome' ? w.instanceId : '';
    expect(server.instances().has(id)).toBe(true);
    ws.close();
    await new Promise((r) => setTimeout(r, 200));
    expect(server.instances().has(id)).toBe(false);
  });

  it('clearing the quota flips to the mini-boss and spawns the boss', async () => {
    const ws = await connect();
    hello(ws, await session('k1'), 'ck', 'K');
    const w = await waitFor(ws, 'welcome');
    const id = w.type === 'welcome' ? w.instanceId : '';
    const inst = server.instances().get(id)!;

    // Teleport onto a trash mob and engage so the FSM kills it (quota=1).
    const mob = [...inst.zone.mobs.values()][0]!;
    const me = inst.zone.players.get(w.type === 'welcome' ? w.you : '')!;
    me.pos = { ...mob.pos };
    ws.send(encodeClientMessage({ type: 'attack', targetId: mob.id, skillId: 'basic-attack' }));

    const status = await waitFor(
      ws,
      'rift-status',
      6000,
    );
    // It may take a couple of status messages; loop until mini-boss.
    let phase = status.type === 'rift-status' ? status.phase : '';
    const start = Date.now();
    while (phase !== 'mini-boss' && Date.now() - start < 6000) {
      const s = await waitFor(ws, 'rift-status', 6000);
      phase = s.type === 'rift-status' ? s.phase : '';
    }
    expect(phase).toBe('mini-boss');
    expect(inst.bossId).toBeTruthy();
    expect([...inst.zone.mobs.values()].some((m) => m.id === inst.bossId)).toBe(true);
    ws.close();
  });
});

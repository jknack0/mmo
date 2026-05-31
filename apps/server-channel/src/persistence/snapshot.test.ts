import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import Redis from 'ioredis';
import { sql, type Kysely } from 'kysely';
import { AddressInfo } from 'node:net';
import { encodeClientMessage, decodeServerMessage, type ServerMessage } from '@mmo/protocol';
import { getZoneDef, buildZoneTileMap, ASHEN_PLAINS, HOLD_VERIDIAN } from '@mmo/domain';
import { createChannelDb } from '../db/client.js';
import type { ChannelDatabase } from '../db/types.js';
import { buildChannelServer, type ChannelServer } from '../channel-server.js';
import { createSnapshotRepo, buildSnapshotState, type SnapshotRepo, type SnapshotState } from './snapshot-repo.js';

const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://mmo:mmo@localhost:5432/mmo_test';
// Own redis db (…/5) so flushes never race the other WS suites.
const REDIS_URL = (process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1').replace(/\/\d+$/, '') + '/5';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitFor(ws: WebSocket, type: ServerMessage['type'], timeoutMs = 2000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`waitFor ${type} timed out`)), timeoutMs);
    const handler = (data: WebSocket.RawData) => {
      let msg: ServerMessage;
      try { msg = decodeServerMessage(data as Uint8Array); } catch { return; }
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('SnapshotWorker + crash recovery (S22)', () => {
  let db: Kysely<ChannelDatabase>;
  let redis: Redis;
  let characterId: string;
  let servers: ChannelServer[] = [];

  beforeAll(async () => {
    db = createChannelDb(DB_URL);
    redis = new Redis(REDIS_URL);
    await redis.flushdb();
  });
  afterAll(async () => {
    await db.destroy();
    await redis.quit();
  });

  beforeEach(async () => {
    await sql`DELETE FROM accounts WHERE email = 'snap@e.com'`.execute(db);
    const acct = await sql<{ id: string }>`INSERT INTO accounts (email, password_hash) VALUES ('snap@e.com','x') RETURNING id`.execute(db);
    const chr = await sql<{ id: string }>`INSERT INTO characters (account_id, name) VALUES (${acct.rows[0]!.id}, 'Wanderer') RETURNING id`.execute(db);
    characterId = chr.rows[0]!.id;
  });
  afterEach(async () => {
    for (const s of servers) await s.stop();
    servers = [];
  });

  async function makeServer(snapshotMs: number): Promise<string> {
    const def = getZoneDef(ASHEN_PLAINS)!;
    const server = buildChannelServer({
      redis,
      db,
      zoneId: ASHEN_PLAINS,
      zone: { size: def.size, tileMap: buildZoneTileMap(ASHEN_PLAINS) },
      mobs: [], // no mobs → no contact damage perturbing the asserted HP
      tickHz: 50,
      snapshotMs,
    });
    await server.start(0);
    servers.push(server);
    return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  function connect(wsUrl: string): Promise<WebSocket> {
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
  async function helloAndWelcome(ws: WebSocket): Promise<string> {
    ws.send(encodeClientMessage({ type: 'hello', sessionToken: await session('snap-acct'), characterId, name: 'Wanderer' }));
    const welcome = await waitFor(ws, 'welcome');
    if (welcome.type !== 'welcome') throw new Error('expected welcome');
    return welcome.you;
  }
  async function readSnapshot(): Promise<SnapshotState | null> {
    return createSnapshotRepo(db).read(characterId);
  }
  async function pollSnapshot(timeoutMs = 1500): Promise<SnapshotState> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const s = await readSnapshot();
      if (s) return s;
      await sleep(25);
    }
    throw new Error('snapshot never appeared');
  }

  it('buildSnapshotState captures zone, position, HP, and dead flag (pure)', () => {
    const player = { pos: { x: 4, y: 9 }, hp: 55, maxHp: 100, dead: false };
    expect(buildSnapshotState(player, ASHEN_PLAINS, 123)).toEqual({
      zoneId: ASHEN_PLAINS, pos: { x: 4, y: 9 }, hp: 55, maxHp: 100, dead: false, ts: 123,
    });
  });

  it('SnapshotRepo round-trips state to characters.snapshot_state', async () => {
    const repo: SnapshotRepo = createSnapshotRepo(db);
    expect(await repo.read(characterId)).toBeNull();
    const state: SnapshotState = { zoneId: ASHEN_PLAINS, pos: { x: 11, y: 2 }, hp: 70, maxHp: 100, dead: false, ts: 1 };
    await repo.write(characterId, state);
    expect(await repo.read(characterId)).toEqual(state);
  });

  it('flushes a snapshot on clean logout (ws close)', async () => {
    const wsUrl = await makeServer(60_000); // timer won't fire; logout drives it
    const ws = await connect(wsUrl);
    const you = await helloAndWelcome(ws);

    // Deterministically place + damage the player, then disconnect.
    const server = servers[0]!;
    const p = server.zoneState().players.get(you)!;
    p.pos = { x: 5, y: 7 };
    p.hp = 42;
    ws.close();

    const snap = await pollSnapshot();
    expect(snap.zoneId).toBe(ASHEN_PLAINS);
    expect(snap.pos).toEqual({ x: 5, y: 7 });
    expect(snap.hp).toBe(42);
    expect(snap.maxHp).toBe(100);
    expect(snap.dead).toBe(false);
  });

  it('the periodic worker flushes a live player within its interval', async () => {
    const wsUrl = await makeServer(80);
    const ws = await connect(wsUrl);
    const you = await helloAndWelcome(ws);
    const p = servers[0]!.zoneState().players.get(you)!;
    p.pos = { x: 3, y: 4 };

    const snap = await pollSnapshot();
    expect(snap.pos).toEqual({ x: 3, y: 4 });
    ws.close();
  });

  it('crash recovery: reconnect restores saved position + HP', async () => {
    // Simulate a prior session's last snapshot.
    await createSnapshotRepo(db).write(characterId, {
      zoneId: ASHEN_PLAINS, pos: { x: 8, y: 9 }, hp: 33, maxHp: 100, dead: false, ts: 0,
    });
    const wsUrl = await makeServer(60_000);
    const ws = await connect(wsUrl);
    const you = await helloAndWelcome(ws);

    const p = servers[0]!.zoneState().players.get(you)!;
    expect(p.pos).toEqual({ x: 8, y: 9 });
    expect(p.hp).toBe(33);
    ws.close();
  });

  it('ignores a snapshot from a different zone (spawns fresh)', async () => {
    await createSnapshotRepo(db).write(characterId, {
      zoneId: HOLD_VERIDIAN, pos: { x: 8, y: 9 }, hp: 33, maxHp: 100, dead: false, ts: 0,
    });
    const wsUrl = await makeServer(60_000);
    const ws = await connect(wsUrl);
    const you = await helloAndWelcome(ws);

    const p = servers[0]!.zoneState().players.get(you)!;
    expect(p.pos).not.toEqual({ x: 8, y: 9 }); // default center, not the cross-zone snapshot
    expect(p.hp).toBe(100); // full
    ws.close();
  });

  it('ignores a dead snapshot (no resurrection at 0 HP)', async () => {
    await createSnapshotRepo(db).write(characterId, {
      zoneId: ASHEN_PLAINS, pos: { x: 8, y: 9 }, hp: 1, maxHp: 100, dead: true, ts: 0,
    });
    const wsUrl = await makeServer(60_000);
    const ws = await connect(wsUrl);
    const you = await helloAndWelcome(ws);

    const p = servers[0]!.zoneState().players.get(you)!;
    expect(p.hp).toBe(100); // spawned fresh, not at the dead snapshot's 1 HP
    expect(p.dead).toBe(false);
    ws.close();
  });
});

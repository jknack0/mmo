import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import Redis from 'ioredis';
import { AddressInfo } from 'node:net';
import {
  encodeClientMessage,
  decodeServerMessage,
  type ServerMessage,
} from '@mmo/protocol';
import { getZoneDef, buildZoneTileMap, ASHEN_PLAINS, HOLD_VERIDIAN } from '@mmo/domain';
import { buildChannelServer, type ChannelServer } from './channel-server.js';

// Own redis db (…/3) so flushes never race the other WS suites.
const REDIS_URL =
  (process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1').replace(/\/\d+$/, '') + '/3';

function waitFor(ws: WebSocket, type: ServerMessage['type'], timeoutMs = 2000): Promise<ServerMessage> {
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

describe('zone transitions (S17)', () => {
  let redis: Redis;
  let server: ChannelServer;
  let wsUrl: string;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL);
    await redis.flushdb();
    const def = getZoneDef(ASHEN_PLAINS)!;
    server = buildChannelServer({
      redis,
      zoneId: ASHEN_PLAINS,
      zone: { size: def.size, tileMap: buildZoneTileMap(ASHEN_PLAINS) },
      mobs: def.mobs,
      tickHz: 50,
    });
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

  it('welcome carries the zone id, npcs, and portals', async () => {
    const ws = await connect();
    ws.send(encodeClientMessage({ type: 'hello', sessionToken: await session('a'), characterId: 'c', name: 'A' }));
    const welcome = await waitFor(ws, 'welcome');
    if (welcome.type !== 'welcome') throw new Error('expected welcome');
    expect(welcome.zoneId).toBe(ASHEN_PLAINS);
    expect(welcome.portals.some((p) => p.targetZoneId === HOLD_VERIDIAN)).toBe(true);
    ws.close();
  });

  it('signals a zone-transition when the player steps onto a portal', async () => {
    const ws = await connect();
    ws.send(encodeClientMessage({ type: 'hello', sessionToken: await session('b'), characterId: 'c2', name: 'B' }));
    const welcome = await waitFor(ws, 'welcome');
    if (welcome.type !== 'welcome') throw new Error('expected welcome');
    const myId = welcome.you;
    const portal = welcome.portals[0]!;

    // Teleport the player onto the portal tile (deterministic, no walking).
    const player = server.zoneState().players.get(myId)!;
    player.pos = { ...portal.pos };

    const transition = await waitFor(ws, 'zone-transition');
    if (transition.type !== 'zone-transition') throw new Error('expected zone-transition');
    expect(transition.zoneId).toBe(portal.targetZoneId);
    ws.close();
  });
});

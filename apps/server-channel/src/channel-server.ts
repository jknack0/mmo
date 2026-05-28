import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { AddressInfo } from 'node:net';
import {
  decodeClientMessage,
  encodeServerMessage,
  type ServerMessage,
  type ClientMessage,
  type Vec2,
  type PlayerId,
} from '@mmo/protocol';
import {
  createZoneState,
  spawnPlayer,
  despawnPlayer,
  setPlayerTarget,
  stepMovement,
  snapshotZone,
  type ZoneState,
} from './zone/zone-state.js';

interface Connection {
  ws: WebSocket;
  playerId: PlayerId | null; // null until Hello validates
}

export interface ChannelServerOptions {
  redis: Redis;
  zone: { size: Vec2; tileMap: number[][] };
  tickHz?: number;
}

export interface ChannelServer {
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  address(): AddressInfo;
  /** Exposed for diagnostics / tests. */
  zoneState(): ZoneState;
}

const DEFAULT_TICK_HZ = 20;

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(encodeServerMessage(msg));
  }
}

export function buildChannelServer(opts: ChannelServerOptions): ChannelServer {
  const tickHz = opts.tickHz ?? DEFAULT_TICK_HZ;
  const tickMs = 1000 / tickHz;
  const dtSec = tickMs / 1000;

  const zone = createZoneState(opts.zone);
  const connections = new Map<WebSocket, Connection>();

  let wss: WebSocketServer | null = null;
  let tickHandle: NodeJS.Timeout | null = null;

  async function authenticateHello(
    sessionToken: string
  ): Promise<{ accountId: string } | null> {
    const accountId = await opts.redis.get(`session:${sessionToken}`);
    return accountId ? { accountId } : null;
  }

  async function handleMessage(ws: WebSocket, conn: Connection, raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = decodeClientMessage(raw);
    } catch {
      send(ws, { type: 'error', reason: 'malformed' });
      return;
    }

    if (conn.playerId === null) {
      if (msg.type !== 'hello') {
        send(ws, { type: 'error', reason: 'expected-hello' });
        ws.close();
        return;
      }
      const session = await authenticateHello(msg.sessionToken);
      if (!session) {
        send(ws, { type: 'error', reason: 'invalid-token' });
        ws.close();
        return;
      }
      const playerId = randomUUID();
      conn.playerId = playerId;
      spawnPlayer(zone, {
        id: playerId,
        characterId: msg.characterId,
        name: msg.name,
      });
      send(ws, {
        type: 'welcome',
        you: playerId,
        zoneSize: zone.size,
        tileMap: zone.tileMap,
      });
      return;
    }

    switch (msg.type) {
      case 'move':
        setPlayerTarget(zone, conn.playerId, msg.target);
        return;
      case 'hello':
        // Already authenticated; ignore.
        return;
    }
  }

  function tick(): void {
    stepMovement(zone, dtSec);
    const snap = snapshotZone(zone);
    const payload = encodeServerMessage({ type: 'snapshot', snapshot: snap });
    for (const { ws } of connections.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  return {
    start(port) {
      return new Promise((resolve, reject) => {
        wss = new WebSocketServer({ port }, () => {
          tickHandle = setInterval(tick, tickMs);
          resolve();
        });
        wss.on('error', reject);
        wss.on('connection', (ws) => {
          const conn: Connection = { ws, playerId: null };
          connections.set(ws, conn);

          ws.on('message', (data) => {
            handleMessage(ws, conn, data.toString()).catch((err) =>
              console.error('[channel] handler error:', err)
            );
          });

          ws.on('close', () => {
            connections.delete(ws);
            if (conn.playerId) despawnPlayer(zone, conn.playerId);
          });

          ws.on('error', (err) => {
            console.error('[channel] ws error:', err.message);
          });
        });
      });
    },

    stop() {
      return new Promise((resolve, reject) => {
        if (tickHandle) {
          clearInterval(tickHandle);
          tickHandle = null;
        }
        if (!wss) return resolve();
        for (const ws of connections.keys()) ws.terminate();
        connections.clear();
        wss.close((err) => (err ? reject(err) : resolve()));
        wss = null;
      });
    },

    address() {
      if (!wss) throw new Error('channel server not started');
      return wss.address() as AddressInfo;
    },

    zoneState() {
      return zone;
    },
  };
}

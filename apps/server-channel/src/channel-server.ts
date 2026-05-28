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
  stepMobs,
  stepBurns,
  performDodge,
  snapshotZone,
  spawnMob,
  type ZoneState,
  type MobSpawnInput,
} from './zone/zone-state.js';
import { engageTarget, advancePlayerCombat } from './combat/combat-system.js';
import { stepResources } from './resources/resource-system.js';
import { loadTripods } from './persistence/tripod-store.js';

interface Connection {
  ws: WebSocket;
  playerId: PlayerId | null; // null until Hello validates
}

export interface ChannelServerOptions {
  redis: Redis;
  zone: { size: Vec2; tileMap: number[][] };
  mobs?: MobSpawnInput[];
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
  for (const mob of opts.mobs ?? []) {
    spawnMob(zone, mob);
  }

  const connections = new Map<WebSocket, Connection>();

  let wss: WebSocketServer | null = null;
  let tickHandle: NodeJS.Timeout | null = null;

  async function authenticateHello(
    sessionToken: string
  ): Promise<{ accountId: string } | null> {
    const accountId = await opts.redis.get(`session:${sessionToken}`);
    return accountId ? { accountId } : null;
  }

  function broadcast(msg: ServerMessage): void {
    const raw = encodeServerMessage(msg);
    for (const { ws } of connections.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(raw);
    }
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
      // Load saved tripod loadout for this character so S09 selections
      // take effect from the first cast.
      const tripods = await loadTripods(opts.redis, msg.characterId);
      spawnPlayer(zone, {
        id: playerId,
        characterId: msg.characterId,
        name: msg.name,
        tripods,
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
      case 'attack': {
        // Attack now means "engage target with sticky FSM" per S06 (#8).
        // The tick loop drives chase + auto-fire + damage broadcasts.
        const ok = engageTarget(
          zone,
          conn.playerId,
          msg.targetId,
          msg.skillId
        );
        if (!ok) {
          send(ws, { type: 'error', reason: 'cannot-engage' });
        }
        return;
      }
      case 'dodge': {
        performDodge(zone, conn.playerId, Date.now());
        return;
      }
      case 'hello':
        return;
    }
  }

  function tick(): void {
    const now = Date.now();
    // Resources advance every tick — done first so any spends inside the
    // FSM step see the updated values.
    for (const player of zone.players.values()) {
      stepResources(player.resources, dtSec, now);
    }
    // Sticky-attack FSM runs BEFORE movement so the FSM's player.target
    // assignment (when chasing) is what MovementSystem consumes this tick.
    for (const player of zone.players.values()) {
      const events = advancePlayerCombat(zone, player.id, now);
      for (const ev of events) {
        broadcast({ type: 'damage', event: ev });
      }
    }
    // Burn DoT — ticks once per second per active stack-set.
    for (const ev of stepBurns(zone, now)) {
      broadcast({ type: 'damage', event: ev });
    }
    stepMovement(zone, dtSec);
    stepMobs(zone, now);
    const payload = encodeServerMessage({ type: 'snapshot', snapshot: snapshotZone(zone) });
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

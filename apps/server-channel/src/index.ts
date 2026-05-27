// SPIKE: Channel service.
// Real role per ADR-0011: one OS process per channel, owns zone state,
// runs a 20Hz tick loop, broadcasts via binary WS protocol.
// Spike differences: JSON not binary; one hardcoded zone; no Postgres/Redis.

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type {
  ClientMessage,
  ServerMessage,
  PlayerState,
  MobState,
  Vec2,
  ZoneSnapshot,
} from '@mmo/protocol';

const PORT = 8081;
const TICK_RATE_HZ = 20;
const TICK_MS = 1000 / TICK_RATE_HZ;
const ZONE_SIZE: Vec2 = { x: 20, y: 20 };
const PLAYER_SPEED_TILES_PER_SEC = 4;
const ATTACK_RANGE_TILES = 2;
const ATTACK_DAMAGE = 12;
const MOB_RESPAWN_MS = 5000;

// ─── Zone state ───────────────────────────────────────────────────

interface Connection {
  ws: WebSocket;
  playerId: string;
  authenticated: boolean;
  lastAttackAt: number;
}

const connections = new Map<WebSocket, Connection>();
const players = new Map<string, PlayerState>();
const mobs = new Map<string, MobState>();

let tickCounter = 0;

function spawnSkeleton(): void {
  const id = `skeleton-${randomUUID().slice(0, 8)}`;
  mobs.set(id, {
    id,
    kind: 'skeleton',
    pos: { x: ZONE_SIZE.x / 2, y: ZONE_SIZE.y / 2 },
    hp: 100,
    maxHp: 100,
    alive: true,
    respawnAt: null,
  });
}

spawnSkeleton();

// ─── Helpers ──────────────────────────────────────────────────────

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg: ServerMessage): void {
  const json = JSON.stringify(msg);
  for (const { ws } of connections.values()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  }
}

function buildSnapshot(): ZoneSnapshot {
  return {
    tick: tickCounter,
    players: [...players.values()],
    mobs: [...mobs.values()],
  };
}

// ─── Message handling ─────────────────────────────────────────────

function handleMessage(ws: WebSocket, conn: Connection, raw: string): void {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    send(ws, { type: 'error', reason: 'malformed-json' });
    return;
  }

  // First message must be hello.
  if (!conn.authenticated) {
    if (msg.type !== 'hello') {
      send(ws, { type: 'error', reason: 'expected-hello' });
      ws.close();
      return;
    }
    // SPIKE: token presence is the only check. Real impl validates with gateway.
    if (!msg.token) {
      send(ws, { type: 'error', reason: 'no-token' });
      ws.close();
      return;
    }
    conn.authenticated = true;

    // Spawn player at a random edge tile.
    const spawnPos: Vec2 = {
      x: Math.floor(Math.random() * ZONE_SIZE.x),
      y: Math.floor(Math.random() * ZONE_SIZE.y),
    };
    players.set(conn.playerId, {
      id: conn.playerId,
      name: msg.name || 'Anon',
      pos: spawnPos,
      target: null,
      hp: 100,
      maxHp: 100,
    });

    send(ws, { type: 'welcome', you: conn.playerId, zoneSize: ZONE_SIZE });
    console.log(`[channel] hello ${msg.name} (${conn.playerId}) at (${spawnPos.x.toFixed(1)}, ${spawnPos.y.toFixed(1)})`);
    return;
  }

  switch (msg.type) {
    case 'move': {
      const player = players.get(conn.playerId);
      if (!player) return;
      // Clamp target to map bounds.
      player.target = {
        x: Math.max(0, Math.min(ZONE_SIZE.x - 1, msg.target.x)),
        y: Math.max(0, Math.min(ZONE_SIZE.y - 1, msg.target.y)),
      };
      break;
    }
    case 'attack': {
      const now = Date.now();
      // Light attack-rate clamp — once per 250ms.
      if (now - conn.lastAttackAt < 250) return;
      conn.lastAttackAt = now;

      const player = players.get(conn.playerId);
      const mob = mobs.get(msg.targetId);
      if (!player || !mob || !mob.alive) return;

      if (dist(player.pos, mob.pos) > ATTACK_RANGE_TILES) {
        send(ws, { type: 'error', reason: 'out-of-range' });
        return;
      }

      mob.hp = Math.max(0, mob.hp - ATTACK_DAMAGE);
      broadcast({
        type: 'damage',
        event: { targetId: mob.id, amount: ATTACK_DAMAGE, attackerId: player.id },
      });
      if (mob.hp <= 0) {
        mob.alive = false;
        mob.respawnAt = Date.now() + MOB_RESPAWN_MS;
        console.log(`[channel] ${mob.id} killed by ${player.name}, respawn in ${MOB_RESPAWN_MS}ms`);
      }
      break;
    }
    case 'hello':
      // Already authenticated; ignore.
      break;
  }
}

// ─── Tick loop ────────────────────────────────────────────────────

function tick(): void {
  tickCounter++;
  const dtSec = TICK_MS / 1000;

  // Move players toward their targets.
  for (const player of players.values()) {
    if (!player.target) continue;
    const dx = player.target.x - player.pos.x;
    const dy = player.target.y - player.pos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const step = PLAYER_SPEED_TILES_PER_SEC * dtSec;
    if (d <= step) {
      player.pos = { ...player.target };
      player.target = null;
    } else {
      player.pos = {
        x: player.pos.x + (dx / d) * step,
        y: player.pos.y + (dy / d) * step,
      };
    }
  }

  // Respawn mobs whose timer is up.
  const now = Date.now();
  for (const mob of mobs.values()) {
    if (!mob.alive && mob.respawnAt !== null && now >= mob.respawnAt) {
      mob.hp = mob.maxHp;
      mob.alive = true;
      mob.respawnAt = null;
      console.log(`[channel] ${mob.id} respawned`);
    }
  }

  // Broadcast snapshot.
  broadcast({ type: 'snapshot', snapshot: buildSnapshot() });
}

setInterval(tick, TICK_MS);

// ─── WebSocket server ─────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  const conn: Connection = {
    ws,
    playerId: randomUUID(),
    authenticated: false,
    lastAttackAt: 0,
  };
  connections.set(ws, conn);

  ws.on('message', (data) => {
    handleMessage(ws, conn, data.toString());
  });

  ws.on('close', () => {
    connections.delete(ws);
    if (conn.authenticated) {
      players.delete(conn.playerId);
      console.log(`[channel] disconnect ${conn.playerId}`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[channel] ws error for ${conn.playerId}:`, err.message);
  });
});

console.log(`[channel] listening on ws://localhost:${PORT}`);
console.log(`[channel] zone size ${ZONE_SIZE.x}x${ZONE_SIZE.y}, tick rate ${TICK_RATE_HZ}Hz`);

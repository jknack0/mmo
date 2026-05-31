// Rift instance server (S19 #21, ADR-0007). A purpose-built channel that hosts
// many *private* Rift instances inside one process — each party gets its own
// ZoneState + phase machine, isolated from every other instance (snapshots are
// scoped to instance members). Kept separate from the shared channel-server so
// the proven static-zone path stays untouched.
//
// Run: ZONE_ID=rift-t1 CHANNEL_ID=rift-t1-ch0 CHANNEL_PORT=8083 …
//
// Lifecycle: hello → join-or-create instance → wave-clear to quota → mini-boss
// → boss death completes → all members handed back to Hold Veridian → empty
// instance torn down.

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { AddressInfo } from 'node:net';
import type { Kysely } from 'kysely';
import {
  decodeClientMessage,
  encodeServerMessage,
  type ServerMessage,
  type ClientMessage,
  type Vec2,
} from '@mmo/protocol';
import {
  getZoneDef,
  buildZoneTileMap,
  createRiftState,
  recordRiftKill,
  riftComplete,
  aggregateEquipped,
  rollItemDrop,
  rarityOf,
  RIFT_T1_ZONE_ID,
  RIFT_KILL_QUOTA,
  RIFT_WAVE_SIZE,
  RIFT_TRASH,
  RIFT_BOSS,
  RIFT_EXIT_ZONE_ID,
  type RiftState,
} from '@mmo/domain';
import {
  createZoneState,
  spawnPlayer,
  despawnPlayer,
  setPlayerTarget,
  stepMovement,
  stepMobAggro,
  snapshotZone,
  spawnMob,
  performDodge,
  addGroundItem,
  type ZoneState,
} from './zone/zone-state.js';
import { engageTarget, advancePlayerCombat } from './combat/combat-system.js';
import { stepResources } from './resources/resource-system.js';
import { loadTripods } from './persistence/tripod-store.js';
import { loadPassives } from './persistence/passive-store.js';
import { createChannelItemRepo, type ChannelItemRepo } from './persistence/item-repo.js';
import { heartbeatChannel, deregisterChannel, type ChannelIdentity } from './persistence/channel-registry.js';
import type { ChannelDatabase } from './db/types.js';

const DEFAULT_TICK_HZ = 20;
const BOSS_CONTACT_DAMAGE = 16; // heavier than trash (6)

export interface RiftServerOptions {
  redis: Redis;
  db?: Kysely<ChannelDatabase>;
  zoneId?: string;
  channelId?: string;
  processUrl?: string;
  heartbeatMs?: number;
  tickHz?: number;
  /** Override the phase-1 quota (tests use a tiny one). */
  quota?: number;
}

export interface RiftServer {
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  address(): AddressInfo;
  /** Exposed for tests/diagnostics. */
  instances(): Map<string, RiftInstance>;
}

interface Connection {
  ws: WebSocket;
  playerId: string | null;
  characterId: string | null;
  instanceId: string | null;
}

export interface RiftInstance {
  id: string;
  zone: ZoneState;
  rift: RiftState;
  bossId: string | null;
  members: Set<Connection>;
  mobCounter: number;
  done: boolean;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(encodeServerMessage(msg));
}

export function buildRiftServer(opts: RiftServerOptions): RiftServer {
  const tickHz = opts.tickHz ?? DEFAULT_TICK_HZ;
  const tickMs = 1000 / tickHz;
  const dtSec = tickMs / 1000;
  const quota = opts.quota ?? RIFT_KILL_QUOTA;
  const zoneId = opts.zoneId ?? RIFT_T1_ZONE_ID;
  const def = getZoneDef(zoneId)!;
  const tileMap = buildZoneTileMap(zoneId);

  const itemRepo: ChannelItemRepo | null = opts.db ? createChannelItemRepo(opts.db) : null;
  const identity: ChannelIdentity | null = opts.channelId
    ? { zoneId, channelId: opts.channelId, processUrl: opts.processUrl ?? '' }
    : null;
  const heartbeatMs = opts.heartbeatMs ?? 5_000;

  const connections = new Map<WebSocket, Connection>();
  const instances = new Map<string, RiftInstance>();

  let wss: WebSocketServer | null = null;
  let tickHandle: NodeJS.Timeout | null = null;
  let heartbeatHandle: NodeJS.Timeout | null = null;
  let stopping = false;

  function authedCount(): number {
    let n = 0;
    for (const c of connections.values()) if (c.playerId !== null) n++;
    return n;
  }
  function publishHeartbeat(): void {
    if (!identity || stopping) return;
    heartbeatChannel(opts.redis, identity, authedCount()).catch(() => {});
  }

  // ── Instance helpers ─────────────────────────────────────────
  function randInteriorTile(zone: ZoneState): Vec2 {
    for (let i = 0; i < 50; i++) {
      const x = 1 + Math.floor(Math.random() * (zone.size.x - 2));
      const y = 1 + Math.floor(Math.random() * (zone.size.y - 2));
      if (zone.tileMap[y]?.[x] === 0) return { x, y };
    }
    return { x: Math.floor(zone.size.x / 2), y: Math.floor(zone.size.y / 2) };
  }

  function spawnTrash(inst: RiftInstance): void {
    const id = `rift-${inst.id.slice(0, 6)}-m${inst.mobCounter++}`;
    spawnMob(inst.zone, { id, kind: RIFT_TRASH.kind, pos: randInteriorTile(inst.zone), maxHp: RIFT_TRASH.maxHp, respawnMs: 1e12 });
  }

  function createInstance(id: string): RiftInstance {
    const zone = createZoneState({ size: def.size, tileMap });
    const inst: RiftInstance = { id, zone, rift: createRiftState(quota), bossId: null, members: new Set(), mobCounter: 0, done: false };
    for (let i = 0; i < RIFT_WAVE_SIZE; i++) spawnTrash(inst);
    instances.set(id, inst);
    return inst;
  }

  function broadcastInstance(inst: RiftInstance, msg: ServerMessage): void {
    const raw = encodeServerMessage(msg);
    for (const conn of inst.members) {
      if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(raw);
    }
  }

  function sendRiftStatus(inst: RiftInstance): void {
    broadcastInstance(inst, { type: 'rift-status', phase: inst.rift.phase, kills: inst.rift.kills, quota: inst.rift.quota });
  }

  function spawnBoss(inst: RiftInstance): void {
    const id = `rift-${inst.id.slice(0, 6)}-boss`;
    inst.bossId = id;
    spawnMob(inst.zone, {
      id,
      kind: RIFT_BOSS.kind,
      pos: { x: Math.floor(inst.zone.size.x / 2), y: Math.floor(inst.zone.size.y / 2) },
      maxHp: RIFT_BOSS.maxHp,
      respawnMs: 1e12,
      contactDamage: BOSS_CONTACT_DAMAGE,
    });
  }

  function onMobDeath(inst: RiftInstance, mobId: string): void {
    if (inst.done) return;
    const isBoss = mobId === inst.bossId;
    const before = inst.rift.phase;
    inst.rift = recordRiftKill(inst.rift, isBoss);
    if (inst.rift.phase !== before) {
      if (inst.rift.phase === 'mini-boss') {
        // Clear remaining trash, then spawn the boss.
        for (const [id, m] of inst.zone.mobs) if (id !== inst.bossId) inst.zone.mobs.delete(id), void m;
        spawnBoss(inst);
      }
      if (riftComplete(inst.rift)) {
        inst.done = true;
        broadcastInstance(inst, { type: 'zone-transition', zoneId: RIFT_EXIT_ZONE_ID });
      }
      sendRiftStatus(inst);
    } else if (inst.rift.phase === 'wave-clear') {
      sendRiftStatus(inst); // kill count ticked up
    }
  }

  function maybeDropLoot(inst: RiftInstance, mob: { kind: string; pos: Vec2 }): void {
    if (!itemRepo) return;
    const drop = rollItemDrop(mob.kind, Math.random, 0);
    if (!drop) return;
    const pos = { ...mob.pos };
    const rarity = rarityOf(drop.baseId, drop.affixes.length);
    itemRepo
      .createDroppedItem(drop.baseId, drop.affixes)
      .then((iid) => addGroundItem(inst.zone, { id: iid, baseId: drop.baseId, pos, rarity }))
      .catch(() => {});
  }

  async function authenticateHello(token: string): Promise<{ accountId: string } | null> {
    const accountId = await opts.redis.get(`session:${token}`);
    return accountId ? { accountId } : null;
  }

  async function handleHello(ws: WebSocket, conn: Connection, msg: Extract<ClientMessage, { type: 'hello' }>): Promise<void> {
    const session = await authenticateHello(msg.sessionToken);
    if (!session) {
      send(ws, { type: 'error', reason: 'invalid-token' });
      ws.close();
      return;
    }
    // Join a party's existing instance, or open a fresh private one.
    let inst = msg.instanceId ? instances.get(msg.instanceId) : undefined;
    if (inst && inst.members.size >= def.cap) {
      send(ws, { type: 'error', reason: 'instance-full' });
      ws.close();
      return;
    }
    if (!inst) inst = createInstance(msg.instanceId || randomUUID());

    const playerId = randomUUID();
    conn.playerId = playerId;
    conn.characterId = msg.characterId;
    conn.instanceId = inst.id;
    inst.members.add(conn);

    const [tripods, passives, equipped] = await Promise.all([
      loadTripods(opts.redis, msg.characterId),
      loadPassives(opts.redis, msg.characterId),
      itemRepo ? itemRepo.equippedInstances(msg.characterId) : Promise.resolve([]),
    ]);
    spawnPlayer(inst.zone, {
      id: playerId,
      characterId: msg.characterId,
      name: msg.name,
      pos: { x: Math.floor(def.size.x / 2), y: def.size.y - 3 }, // enter at the south edge
      tripods,
      passives,
      itemStats: aggregateEquipped(equipped),
    });
    send(ws, {
      type: 'welcome',
      you: playerId,
      zoneId,
      instanceId: inst.id,
      zoneSize: inst.zone.size,
      tileMap: inst.zone.tileMap,
      npcs: [],
      portals: [],
    });
    sendRiftStatus(inst);
    publishHeartbeat();
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
      await handleHello(ws, conn, msg);
      return;
    }
    const inst = conn.instanceId ? instances.get(conn.instanceId) : undefined;
    if (!inst) return;
    if (inst.zone.players.get(conn.playerId)?.dead) return; // corpse frozen
    switch (msg.type) {
      case 'move':
        setPlayerTarget(inst.zone, conn.playerId, msg.target);
        return;
      case 'attack':
        if (!engageTarget(inst.zone, conn.playerId, msg.targetId, msg.skillId)) {
          send(ws, { type: 'error', reason: 'cannot-engage' });
        }
        return;
      case 'dodge':
        performDodge(inst.zone, conn.playerId, Date.now());
        return;
      default:
        return; // pickups/use-item not wired in the Rift tracer
    }
  }

  function tickInstance(inst: RiftInstance, now: number): void {
    for (const player of inst.zone.players.values()) stepResources(player.resources, dtSec, now);
    for (const player of inst.zone.players.values()) {
      for (const ev of advancePlayerCombat(inst.zone, player.id, now)) {
        broadcastInstance(inst, { type: 'damage', event: ev });
        if (ev.fatal) {
          const mob = inst.zone.mobs.get(ev.targetId);
          if (mob) maybeDropLoot(inst, mob);
          onMobDeath(inst, ev.targetId);
        }
      }
    }
    stepMovement(inst.zone, dtSec);
    for (const hit of stepMobAggro(inst.zone, dtSec, now)) {
      broadcastInstance(inst, {
        type: 'damage',
        event: { targetId: hit.playerId, attackerId: hit.mobId, amount: hit.amount, fatal: hit.fatal, skillId: 'mob-contact' },
      });
    }
    // Remove dead mobs + keep the wave topped up until the quota.
    for (const [id, m] of inst.zone.mobs) if (!m.alive) inst.zone.mobs.delete(id);
    if (!inst.done && inst.rift.phase === 'wave-clear') {
      let alive = 0;
      for (const m of inst.zone.mobs.values()) if (m.alive) alive++;
      for (let i = alive; i < RIFT_WAVE_SIZE; i++) spawnTrash(inst);
    }
    broadcastInstance(inst, { type: 'snapshot', snapshot: snapshotZone(inst.zone) });
  }

  function tick(): void {
    const now = Date.now();
    for (const inst of instances.values()) tickInstance(inst, now);
  }

  return {
    start(port) {
      return new Promise((resolve, reject) => {
        wss = new WebSocketServer({ port }, () => {
          tickHandle = setInterval(tick, tickMs);
          if (identity) {
            publishHeartbeat();
            heartbeatHandle = setInterval(publishHeartbeat, heartbeatMs);
          }
          resolve();
        });
        wss.on('error', reject);
        wss.on('connection', (ws) => {
          const conn: Connection = { ws, playerId: null, characterId: null, instanceId: null };
          connections.set(ws, conn);
          ws.on('message', (data) => {
            handleMessage(ws, conn, data.toString()).catch((err) => console.error('[rift] handler error:', err));
          });
          ws.on('close', () => {
            connections.delete(ws);
            const inst = conn.instanceId ? instances.get(conn.instanceId) : undefined;
            if (inst) {
              inst.members.delete(conn);
              if (conn.playerId) despawnPlayer(inst.zone, conn.playerId);
              if (inst.members.size === 0) instances.delete(inst.id); // teardown
            }
            publishHeartbeat();
          });
          ws.on('error', (err) => console.error('[rift] ws error:', err.message));
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        stopping = true;
        if (tickHandle) clearInterval(tickHandle), (tickHandle = null);
        if (heartbeatHandle) clearInterval(heartbeatHandle), (heartbeatHandle = null);
        if (identity) deregisterChannel(opts.redis, identity).catch(() => {});
        if (!wss) return resolve();
        for (const ws of connections.keys()) ws.terminate();
        connections.clear();
        instances.clear();
        wss.close((err) => (err ? reject(err) : resolve()));
        wss = null;
      });
    },
    address() {
      if (!wss) throw new Error('rift server not started');
      return wss.address() as AddressInfo;
    },
    instances() {
      return instances;
    },
  };
}

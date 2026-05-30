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
  type PlayerId,
} from '@mmo/protocol';
import { rollItemDrop, aggregateEquipped, rarityOf } from '@mmo/domain';
import {
  createZoneState,
  spawnPlayer,
  despawnPlayer,
  setPlayerTarget,
  stepMovement,
  stepMobs,
  stepMobAggro,
  stepBurns,
  performDodge,
  snapshotZone,
  spawnMob,
  addGroundItem,
  removeGroundItem,
  type ZoneState,
  type MobSpawnInput,
} from './zone/zone-state.js';
import { engageTarget, advancePlayerCombat } from './combat/combat-system.js';
import { stepResources } from './resources/resource-system.js';
import { loadTripods } from './persistence/tripod-store.js';
import { loadPassives } from './persistence/passive-store.js';
import { createChannelItemRepo, type ChannelItemRepo } from './persistence/item-repo.js';
import type { ChannelDatabase } from './db/types.js';

interface Connection {
  ws: WebSocket;
  playerId: PlayerId | null; // null until Hello validates
  characterId: string | null;
  accountId: string | null; // set on Hello; recorded on audit rows
}

export interface ChannelServerOptions {
  redis: Redis;
  /** Optional Postgres handle. When present, mob drops + pickups persist
   *  (ADR-0013 write-through) and equipped gear loads on Hello. Tests that
   *  don't exercise items omit it. */
  db?: Kysely<ChannelDatabase>;
  zone: { size: Vec2; tileMap: number[][] };
  mobs?: MobSpawnInput[];
  tickHz?: number;
}

/** Tiles a player must be within to grab a ground item. */
const PICKUP_RADIUS = 1.5;

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
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

  const itemRepo: ChannelItemRepo | null = opts.db ? createChannelItemRepo(opts.db) : null;
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
      conn.characterId = msg.characterId;
      conn.accountId = session.accountId;
      // Load saved tripod + passive loadouts (Redis) and equipped gear
      // (Postgres) so S09/S10/S13 selections take effect from the first cast.
      // equippedPyroSkillCount defaults to the full 6-of-6 Pyro hotbar at
      // alpha (drives Annihilator).
      const [tripods, passives, equipped] = await Promise.all([
        loadTripods(opts.redis, msg.characterId),
        loadPassives(opts.redis, msg.characterId),
        itemRepo ? itemRepo.equippedInstances(msg.characterId) : Promise.resolve([]),
      ]);
      spawnPlayer(zone, {
        id: playerId,
        characterId: msg.characterId,
        name: msg.name,
        tripods,
        passives,
        itemStats: aggregateEquipped(equipped),
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
      case 'pickup': {
        await handlePickup(ws, conn, msg.itemId);
        return;
      }
      case 'use-item': {
        await handleUseItem(ws, conn, msg.itemId);
        return;
      }
      case 'hello':
        return;
    }
  }

  /**
   * Use a consumable: remove it from inventory + write the audit row (channel
   * item-repo, one transaction) and apply its heal to the in-world player. The
   * player is server-authoritative, so the heal lands here and surfaces via the
   * next snapshot's hp; a `consumed` ack lets the client drop the item + float.
   */
  async function handleUseItem(ws: WebSocket, conn: Connection, itemId: string): Promise<void> {
    if (!itemRepo || !conn.playerId || !conn.characterId) return;
    const player = zone.players.get(conn.playerId);
    if (!player) return;
    const result = await itemRepo.consume(conn.characterId, conn.accountId, itemId);
    if (!result) {
      send(ws, { type: 'error', reason: 'cannot-consume' });
      return;
    }
    player.hp = Math.min(player.maxHp, player.hp + result.heal);
    send(ws, { type: 'consumed', itemId, heal: result.heal });
  }

  /**
   * Proximity-gated pickup. The ground item is claimed synchronously (removed
   * from the zone) so two near-simultaneous requests can't both win, then the
   * write-through to Postgres runs; on failure the item is restored.
   */
  async function handlePickup(ws: WebSocket, conn: Connection, itemId: string): Promise<void> {
    if (!itemRepo || !conn.playerId || !conn.characterId) return;
    const player = zone.players.get(conn.playerId);
    const item = zone.groundItems.get(itemId);
    if (!player || !item) return;
    if (dist(player.pos, item.pos) > PICKUP_RADIUS) {
      send(ws, { type: 'error', reason: 'too-far' });
      return;
    }
    removeGroundItem(zone, itemId); // claim before the await
    try {
      await itemRepo.pickUp(conn.characterId, itemId);
      send(ws, { type: 'picked-up', itemId, baseId: item.baseId });
    } catch (err) {
      console.error('[channel] pickup failed, restoring item:', err);
      addGroundItem(zone, item);
    }
  }

  /**
   * Roll the loot table for a freshly-killed mob (rarity + affixes, biased by
   * the killer's Magic Find) and, on a hit, mint a server-issued item
   * (write-through) before placing it on the ground with its rarity.
   */
  function maybeDropLoot(mobId: string, killerId: string): void {
    if (!itemRepo) return;
    const mob = zone.mobs.get(mobId);
    if (!mob) return;
    const magicFind = zone.players.get(killerId)?.derivedStats.magicFind ?? 0;
    const drop = rollItemDrop(mob.kind, Math.random, magicFind);
    if (!drop) return;
    const pos = { ...mob.pos };
    const rarity = rarityOf(drop.baseId, drop.affixes.length);
    itemRepo
      .createDroppedItem(drop.baseId, drop.affixes)
      .then((id) => addGroundItem(zone, { id, baseId: drop.baseId, pos, rarity }))
      .catch((err) => console.error('[channel] drop mint failed:', err));
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
        if (ev.fatal) maybeDropLoot(ev.targetId, ev.attackerId);
      }
    }
    // Burn DoT — ticks once per second per active stack-set.
    for (const ev of stepBurns(zone, now)) {
      broadcast({ type: 'damage', event: ev });
      if (ev.fatal) maybeDropLoot(ev.targetId, ev.attackerId);
    }
    stepMovement(zone, dtSec);
    stepMobs(zone, now);
    // Mob aggro — chase + contact damage. Player hp surfaces via the snapshot;
    // each bite also broadcasts a damage event (target = the player) so the
    // client can float the number. skillId 'mob-contact' tags it for FX.
    for (const hit of stepMobAggro(zone, dtSec, now)) {
      broadcast({
        type: 'damage',
        event: {
          targetId: hit.playerId,
          attackerId: hit.mobId,
          amount: hit.amount,
          fatal: hit.fatal,
          skillId: 'mob-contact',
        },
      });
    }
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
          const conn: Connection = { ws, playerId: null, characterId: null, accountId: null };
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

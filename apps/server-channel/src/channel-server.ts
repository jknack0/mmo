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
  computeSnapshotDelta,
  emptyFrame,
  type HandledFrame,
  type ZoneSnapshot,
} from '@mmo/protocol';
import { rollItemDrop, aggregateEquipped, rarityOf, getZoneDef, portalAt } from '@mmo/domain';
import type { WorldNpc, WorldPortal } from '@mmo/protocol';
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
import { createSnapshotRepo, buildSnapshotState, type SnapshotRepo } from './persistence/snapshot-repo.js';
import { heartbeatChannel, deregisterChannel, type ChannelIdentity } from './persistence/channel-registry.js';
import type { ChannelDatabase } from './db/types.js';

interface Connection {
  ws: WebSocket;
  playerId: PlayerId | null; // null until Hello validates
  characterId: string | null;
  accountId: string | null; // set on Hello; recorded on audit rows
  /** Portal the player currently stands on — debounces the transition signal. */
  onPortalId: string | null;
  /** Delta snapshots (S24): force a full keyframe on the player's first frame. */
  needsKeyframe?: boolean;
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
  // ─── Channel routing (S04 #6, ADR-0011) ───
  /** Zone this channel serves. Default 'ashen-plains'. */
  zoneId?: string;
  /** Routing id. When set, the channel self-registers + heartbeats to Redis. */
  channelId?: string;
  /** WS URL clients use to reach this process (what the router hands back). */
  processUrl?: string;
  /** Max concurrent players. When set, joins past it are refused. */
  capacity?: number;
  /** Heartbeat interval ms (load → routing table). Default 5000. */
  heartbeatMs?: number;
  /** SnapshotWorker flush interval ms (S22). Default 30000. Needs `db`. */
  snapshotMs?: number;
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
  const snapshotRepo: SnapshotRepo | null = opts.db ? createSnapshotRepo(opts.db) : null;
  const snapshotMs = opts.snapshotMs ?? 30_000;
  const connections = new Map<WebSocket, Connection>();

  // SnapshotWorker (S22, ADR-0013): flush a connection's volatile session state
  // (zone + position + HP) to Postgres. Fire-and-forget so the tick loop and
  // the ws-close path never block on the write.
  function flushSnapshot(conn: Connection): void {
    if (!snapshotRepo || stopping || !conn.playerId || !conn.characterId) return;
    const player = zone.players.get(conn.playerId);
    if (!player) return;
    const state = buildSnapshotState(player, opts.zoneId ?? '', Date.now());
    void snapshotRepo
      .write(conn.characterId, state)
      .catch((err) => console.error('[channel] snapshot write failed:', err));
  }
  function flushAllSnapshots(): void {
    if (!snapshotRepo) return;
    for (const conn of connections.values()) flushSnapshot(conn);
  }

  // ─── Delta snapshots (S24) ──────────────────────────────────────
  // Entities are referenced by a small, stable per-zone handle so deltas don't
  // resend 36-byte UUIDs. A keyframe (full state) is broadcast every KEYFRAME_MS
  // and whenever a player joins (needs a baseline); all other ticks send a delta
  // against the shared previous frame.
  const KEYFRAME_MS = 5_000;
  const handleOf = new Map<string, number>();
  let nextHandle = 1;
  let prevFrame: HandledFrame = emptyFrame();
  let lastKeyframeAt = 0;

  function toHandledFrame(snap: ZoneSnapshot): HandledFrame {
    const f = emptyFrame(snap.tick);
    const seen = new Set<string>();
    const handle = (key: string): number => {
      let h = handleOf.get(key);
      if (h === undefined) { h = nextHandle++; handleOf.set(key, h); }
      seen.add(key);
      return h;
    };
    for (const p of snap.players) f.players.set(handle('p:' + p.id), p);
    for (const m of snap.mobs) f.mobs.set(handle('m:' + m.id), m);
    for (const g of snap.groundItems) f.ground.set(handle('g:' + g.id), g);
    for (const key of [...handleOf.keys()]) if (!seen.has(key)) handleOf.delete(key); // retire gone ids
    return f;
  }

  function broadcastFrame(now: number): void {
    const frame = toHandledFrame(snapshotZone(zone));
    const anyNeedsKeyframe = [...connections.values()].some((c) => c.playerId && c.needsKeyframe);
    const keyframe = anyNeedsKeyframe || now - lastKeyframeAt >= KEYFRAME_MS;
    let msg: ServerMessage;
    if (keyframe) {
      msg = {
        type: 'keyframe', tick: frame.tick,
        players: [...frame.players].map(([h, p]) => ({ h, ...p })),
        mobs: [...frame.mobs].map(([h, m]) => ({ h, ...m })),
        ground: [...frame.ground].map(([h, g]) => ({ h, ...g })),
      };
      lastKeyframeAt = now;
      for (const c of connections.values()) c.needsKeyframe = false;
    } else {
      msg = { type: 'delta', delta: computeSnapshotDelta(prevFrame, frame) };
    }
    prevFrame = frame;
    const payload = encodeServerMessage(msg);
    for (const { ws } of connections.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  // Routing self-registration is enabled only when a channelId is configured
  // (the standalone test servers omit it and stay off the routing table).
  const identity: ChannelIdentity | null = opts.channelId
    ? { zoneId: opts.zoneId ?? 'ashen-plains', channelId: opts.channelId, processUrl: opts.processUrl ?? '' }
    : null;
  const heartbeatMs = opts.heartbeatMs ?? 5_000;

  // Static world content for this zone (S17): NPCs + zone-exit portals. Sent on
  // welcome; portals also drive the per-tick zone-transition handoff.
  const zoneDef = opts.zoneId ? getZoneDef(opts.zoneId) : undefined;
  const npcs: WorldNpc[] = (zoneDef?.npcs ?? []).map((n) => ({ ...n, pos: { ...n.pos } }));
  const portals: WorldPortal[] = (zoneDef?.portals ?? []).map((p) => ({
    id: p.id,
    pos: { ...p.pos },
    targetZoneId: p.targetZoneId,
    label: p.label,
  }));

  let wss: WebSocketServer | null = null;
  let tickHandle: NodeJS.Timeout | null = null;
  let heartbeatHandle: NodeJS.Timeout | null = null;
  let snapshotHandle: NodeJS.Timeout | null = null;
  let stopping = false;

  /** Players currently authenticated on this channel (drives load + capacity). */
  function authedCount(): number {
    let n = 0;
    for (const c of connections.values()) if (c.playerId !== null) n++;
    return n;
  }

  function publishHeartbeat(): void {
    if (!identity || stopping) return;
    heartbeatChannel(opts.redis, identity, authedCount()).catch((err) =>
      console.error('[channel] heartbeat failed:', err)
    );
  }

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

  async function handleMessage(ws: WebSocket, conn: Connection, raw: Uint8Array | string): Promise<void> {
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
      // Capacity enforcement (ADR-0011): refuse the join when full so the
      // gateway router sends the next player to another channel.
      if (opts.capacity !== undefined && authedCount() >= opts.capacity) {
        send(ws, { type: 'error', reason: 'channel-full' });
        ws.close();
        return;
      }
      const playerId = randomUUID();
      conn.playerId = playerId;
      conn.characterId = msg.characterId;
      conn.accountId = session.accountId;
      conn.needsKeyframe = true; // first frame must be a full keyframe (S24)
      // Load saved tripod + passive loadouts (Redis) and equipped gear
      // (Postgres) so S09/S10/S13 selections take effect from the first cast.
      // equippedPyroSkillCount defaults to the full 6-of-6 Pyro hotbar at
      // alpha (drives Annihilator).
      const [tripods, passives, equipped, snapshot] = await Promise.all([
        loadTripods(opts.redis, msg.characterId),
        loadPassives(opts.redis, msg.characterId),
        itemRepo ? itemRepo.equippedInstances(msg.characterId) : Promise.resolve([]),
        snapshotRepo ? snapshotRepo.read(msg.characterId) : Promise.resolve(null),
      ]);
      // Crash recovery (S22): if the last snapshot was in THIS zone and the
      // player wasn't dead, respawn them at their saved position + HP. A
      // cross-zone or dead snapshot is ignored — they spawn fresh.
      const restore =
        snapshot && snapshot.zoneId === (opts.zoneId ?? '') && !snapshot.dead
          ? snapshot
          : null;
      spawnPlayer(zone, {
        id: playerId,
        characterId: msg.characterId,
        name: msg.name,
        tripods,
        passives,
        itemStats: aggregateEquipped(equipped),
        pos: restore ? { x: restore.pos.x, y: restore.pos.y } : undefined,
        hp: restore ? restore.hp : undefined,
      });
      send(ws, {
        type: 'welcome',
        you: playerId,
        zoneId: opts.zoneId ?? '',
        instanceId: '',
        zoneSize: zone.size,
        tileMap: zone.tileMap,
        npcs,
        portals,
      });
      publishHeartbeat(); // load changed → refresh routing immediately
      return;
    }

    // A downed player (S18) is frozen — they take no in-world actions until they
    // respawn in town (which reconnects them to that channel).
    if (zone.players.get(conn.playerId)?.dead) return;

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
    // Zone transitions (S17): a player standing on a portal is handed off to
    // the target zone's channel. Edge-triggered via conn.onPortalId so the
    // signal fires once on entry, not every tick while they stand there.
    if (portals.length > 0) {
      for (const conn of connections.values()) {
        if (!conn.playerId) continue;
        const player = zone.players.get(conn.playerId);
        if (!player || player.dead) continue;
        const p = portalAt(portals, player.pos);
        if (p && conn.onPortalId !== p.id) {
          conn.onPortalId = p.id;
          // Flush before the handoff so the target zone restores fresh state (S22).
          flushSnapshot(conn);
          send(conn.ws, { type: 'zone-transition', zoneId: p.targetZoneId });
        } else if (!p) {
          conn.onPortalId = null;
        }
      }
    }

    broadcastFrame(Date.now());
  }

  return {
    start(port) {
      return new Promise((resolve, reject) => {
        wss = new WebSocketServer({ port }, () => {
          tickHandle = setInterval(tick, tickMs);
          // Self-register + heartbeat into the routing table (S04). Publish
          // once now so the channel is routable before its first heartbeat.
          if (identity) {
            publishHeartbeat();
            heartbeatHandle = setInterval(publishHeartbeat, heartbeatMs);
          }
          // SnapshotWorker: periodic flush of all live players (S22).
          if (snapshotRepo) {
            snapshotHandle = setInterval(flushAllSnapshots, snapshotMs);
          }
          resolve();
        });
        wss.on('error', reject);
        wss.on('connection', (ws) => {
          const conn: Connection = { ws, playerId: null, characterId: null, accountId: null, onPortalId: null };
          connections.set(ws, conn);

          ws.on('message', (data) => {
            // Pass the raw frame bytes (binary wire, S23). The decoder accepts a
            // Buffer/Uint8Array and self-describes off the magic byte.
            const bytes = Array.isArray(data) ? Buffer.concat(data) : (data as Buffer);
            handleMessage(ws, conn, bytes).catch((err) =>
              console.error('[channel] handler error:', err)
            );
          });

          ws.on('close', () => {
            // Snapshot the final state on clean logout BEFORE despawn removes
            // the player from the zone (S22).
            flushSnapshot(conn);
            connections.delete(ws);
            if (conn.playerId) {
              despawnPlayer(zone, conn.playerId);
              publishHeartbeat(); // slot freed → refresh routing immediately
            }
          });

          ws.on('error', (err) => {
            console.error('[channel] ws error:', err.message);
          });
        });
      });
    },

    stop() {
      return new Promise((resolve, reject) => {
        stopping = true;
        if (tickHandle) {
          clearInterval(tickHandle);
          tickHandle = null;
        }
        if (heartbeatHandle) {
          clearInterval(heartbeatHandle);
          heartbeatHandle = null;
        }
        if (snapshotHandle) {
          clearInterval(snapshotHandle);
          snapshotHandle = null;
        }
        if (identity) {
          deregisterChannel(opts.redis, identity).catch(() => {});
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

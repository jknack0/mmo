import type {
  PlayerId,
  CharacterId,
  EntityId,
  SkillId,
  Vec2,
  ZoneSnapshot,
  PlayerState,
  MobState,
  GroundItem,
} from '@mmo/protocol';

export type PlayerAttackState =
  | { kind: 'idle' }
  | { kind: 'chasing'; targetId: EntityId; skillId: SkillId }
  | { kind: 'in-range-attacking'; targetId: EntityId; skillId: SkillId };

import type { ResourceState } from '../resources/resource-system.js';
import type { PlayerTripodLoadout } from '../combat/tripods.js';
import {
  computeDerivedStats,
  type DerivedStats,
  type PassiveAllocation,
  type AggregatedItemStats,
} from '@mmo/domain';

export interface ServerPlayer {
  id: PlayerId;
  characterId: CharacterId;
  name: string;
  pos: Vec2;
  target: Vec2 | null;
  /** Tiles per second. */
  speed: number;
  /** Per-skill cooldown expiry (wall-clock ms). */
  cooldowns: Map<SkillId, number>;
  /** Sticky-attack-target FSM per PROTOTYPE_NOTES.md lesson #1. */
  attackState: PlayerAttackState;
  /** Spirit + Wrath resources per ADR-0010. */
  resources: ResourceState;
  /** Wall-clock ms when this player's dodge i-frame window ends. */
  dodgeInvulUntil: number;
  /** Tripod selections per skill (per ADR-0018). Default {} = base skill. */
  tripods: PlayerTripodLoadout;
  /** Passive allocation (ADR-0018 shared pool). Default {} = no nodes. */
  passives: PassiveAllocation;
  /** Folded passive effects applied throughout combat (S10 #12). */
  derivedStats: DerivedStats;
}

export interface ServerMob {
  id: EntityId;
  kind: string;
  pos: Vec2;
  spawnPos: Vec2;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Wall-clock ms when a dead mob should respawn. */
  respawnAt: number | null;
  respawnMs: number;
  /** Active Burn stacks (Fire DoT, ADR Pyromancy doc). */
  burnStacks: number;
  /** Wall-clock ms when the current stack set expires. */
  burnExpiresAt: number;
  /** Wall-clock ms when the last Burn tick fired. */
  burnLastTickAt: number;
  /** PlayerId most recently responsible for the active Burn — receives credit for ticks. */
  burnLastAttackerId: PlayerId | null;
}

/** A dropped item lying in the world (S13). `id` is the server-issued item UUID. */
export interface ServerGroundItem {
  id: EntityId;
  baseId: string;
  pos: Vec2;
}

export interface ZoneState {
  size: Vec2;
  tileMap: number[][];
  players: Map<PlayerId, ServerPlayer>;
  mobs: Map<EntityId, ServerMob>;
  groundItems: Map<EntityId, ServerGroundItem>;
  tick: number;
}

export interface PlayerSpawnInput {
  id: PlayerId;
  characterId: CharacterId;
  name: string;
  pos?: Vec2;
  speed?: number;
  tripods?: PlayerTripodLoadout;
  passives?: PassiveAllocation;
  /** Equipped Pyro skill count — drives the Annihilator loadout-synergy node. */
  equippedPyroSkillCount?: number;
  /** Aggregated stats of equipped items (S13) — folded into derivedStats. */
  itemStats?: AggregatedItemStats;
}

export interface MobSpawnInput {
  id: EntityId;
  kind: string;
  pos: Vec2;
  maxHp: number;
  respawnMs?: number;
}

import { createResourceState } from '../resources/resource-system.js';

const DEFAULT_SPEED_TILES_PER_SEC = 4;
const DEFAULT_RESPAWN_MS = 5_000;
const DEFAULT_MAX_SPIRIT = 100;
const DEFAULT_MAX_WRATH = 100;

export function createZoneState(opts: { size: Vec2; tileMap: number[][] }): ZoneState {
  return {
    size: opts.size,
    tileMap: opts.tileMap,
    players: new Map(),
    mobs: new Map(),
    groundItems: new Map(),
    tick: 0,
  };
}

// ─── Ground items (S13) ───────────────────────────────────────

/** Place a dropped item in the world. The id is the server-issued item UUID. */
export function addGroundItem(zone: ZoneState, item: ServerGroundItem): void {
  zone.groundItems.set(item.id, { ...item, pos: { ...item.pos } });
}

export function removeGroundItem(zone: ZoneState, itemId: EntityId): ServerGroundItem | undefined {
  const item = zone.groundItems.get(itemId);
  if (item) zone.groundItems.delete(itemId);
  return item;
}

/**
 * The nearest ground item within `radius` tiles of `pos`, if any. Used for
 * proximity-gated pickup so a player can only grab loot they're standing near.
 */
export function nearestGroundItem(
  zone: ZoneState,
  pos: Vec2,
  radius: number
): ServerGroundItem | undefined {
  let best: ServerGroundItem | undefined;
  let bestDist = radius;
  for (const item of zone.groundItems.values()) {
    const dx = item.pos.x - pos.x;
    const dy = item.pos.y - pos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= bestDist) {
      best = item;
      bestDist = d;
    }
  }
  return best;
}

export function spawnPlayer(zone: ZoneState, input: PlayerSpawnInput): ServerPlayer {
  const pos = input.pos ?? {
    x: Math.floor(zone.size.x / 2),
    y: Math.floor(zone.size.y / 2),
  };
  const passives = input.passives ?? {};
  const derivedStats = computeDerivedStats(passives, {
    equippedPyroSkillCount: input.equippedPyroSkillCount,
    itemStats: input.itemStats,
  });
  const player: ServerPlayer = {
    id: input.id,
    characterId: input.characterId,
    name: input.name,
    pos: { ...pos },
    target: null,
    speed: input.speed ?? DEFAULT_SPEED_TILES_PER_SEC,
    cooldowns: new Map(),
    attackState: { kind: 'idle' },
    resources: createResourceState({
      maxSpirit: Math.round(DEFAULT_MAX_SPIRIT * derivedStats.maxSpiritMult),
      maxWrath: DEFAULT_MAX_WRATH,
    }),
    dodgeInvulUntil: 0,
    tripods: input.tripods ?? {},
    passives,
    derivedStats,
  };
  zone.players.set(input.id, player);
  return player;
}

export function despawnPlayer(zone: ZoneState, id: PlayerId): void {
  zone.players.delete(id);
}

export function spawnMob(zone: ZoneState, input: MobSpawnInput): ServerMob {
  const mob: ServerMob = {
    id: input.id,
    kind: input.kind,
    pos: { ...input.pos },
    spawnPos: { ...input.pos },
    hp: input.maxHp,
    maxHp: input.maxHp,
    alive: true,
    respawnAt: null,
    respawnMs: input.respawnMs ?? DEFAULT_RESPAWN_MS,
    burnStacks: 0,
    burnExpiresAt: 0,
    burnLastTickAt: 0,
    burnLastAttackerId: null,
  };
  zone.mobs.set(input.id, mob);
  return mob;
}

// ─── Spacebar dodge ───────────────────────────────────────────

export const DODGE_TILES = 4;
export const DODGE_COOLDOWN_MS = 3_000;
export const DODGE_INVUL_MS = 300;
const DODGE_SKILL_ID = 'dodge';

/**
 * Apply a player-initiated dodge: short dash + brief i-frames, gated by
 * a per-player cooldown stored on the player's cooldowns map. Returns
 * false if the dodge was refused (still on cooldown).
 */
export function performDodge(
  zone: ZoneState,
  playerId: PlayerId,
  nowMs: number
): boolean {
  const player = zone.players.get(playerId);
  if (!player) return false;
  const expires = player.cooldowns.get(DODGE_SKILL_ID) ?? 0;
  if (nowMs < expires) return false;

  // Direction: toward the current move target if any, otherwise default east.
  let dx = 1, dy = 0;
  if (player.target) {
    const tx = player.target.x - player.pos.x;
    const ty = player.target.y - player.pos.y;
    const d = Math.sqrt(tx * tx + ty * ty);
    if (d > 0.01) {
      dx = tx / d;
      dy = ty / d;
    }
  }
  // Try the full dash; if the landing tile is blocked, halve until walkable.
  let landed: Vec2 = { x: player.pos.x, y: player.pos.y };
  for (let step = 1; step >= 0.25; step -= 0.25) {
    const candidate: Vec2 = {
      x: Math.max(0, Math.min(zone.size.x - 1, player.pos.x + dx * DODGE_TILES * step)),
      y: Math.max(0, Math.min(zone.size.y - 1, player.pos.y + dy * DODGE_TILES * step)),
    };
    if (isWalkable(zone, candidate)) {
      landed = candidate;
      break;
    }
  }
  player.pos = landed;
  player.target = null;
  player.cooldowns.set(DODGE_SKILL_ID, nowMs + DODGE_COOLDOWN_MS);
  player.dodgeInvulUntil = nowMs + DODGE_INVUL_MS;
  player.attackState = { kind: 'idle' };
  return true;
}

// ─── Burn DoT ─────────────────────────────────────────────────

export const BURN_CAP = 5;
export const BURN_DURATION_MS = 6_000;
export const BURN_TICK_INTERVAL_MS = 1_000;
export const BURN_DAMAGE_PER_STACK = 2;

/**
 * Add Burn stacks to a mob (no-op on dead mobs). Stacks cap at `opts.cap`
 * (default BURN_CAP; Searing Touch raises it, Inferno passes Infinity) and the
 * expiry is refreshed to `opts.durationMs` from now (default BURN_DURATION_MS;
 * Lingering Heat extends it). Per S10 #12 the caller derives both from the
 * attacker's passive stats.
 */
export function applyBurnStacks(
  zone: ZoneState,
  mobId: EntityId,
  stacks: number,
  attackerId: PlayerId,
  nowMs: number,
  opts: { cap?: number; durationMs?: number } = {}
): void {
  const mob = zone.mobs.get(mobId);
  if (!mob || !mob.alive) return;
  const cap = opts.cap ?? BURN_CAP;
  const durationMs = opts.durationMs ?? BURN_DURATION_MS;
  mob.burnStacks = Math.min(cap, mob.burnStacks + stacks);
  mob.burnExpiresAt = nowMs + durationMs;
  mob.burnLastAttackerId = attackerId;
  // First-time application: align the tick clock so the first tick lands
  // BURN_TICK_INTERVAL_MS in the future, not immediately.
  if (mob.burnLastTickAt === 0) {
    mob.burnLastTickAt = nowMs;
  }
}

/**
 * Advance the Burn DoT for every mob and return any Damage events fired.
 * Stacks clear automatically once burnExpiresAt is reached.
 */
export function stepBurns(
  zone: ZoneState,
  nowMs: number
): { targetId: EntityId; attackerId: PlayerId; amount: number; fatal: boolean }[] {
  const events: { targetId: EntityId; attackerId: PlayerId; amount: number; fatal: boolean }[] = [];
  for (const mob of zone.mobs.values()) {
    if (!mob.alive || mob.burnStacks === 0) continue;
    if (nowMs >= mob.burnExpiresAt) {
      mob.burnStacks = 0;
      mob.burnLastAttackerId = null;
      continue;
    }
    if (nowMs - mob.burnLastTickAt >= BURN_TICK_INTERVAL_MS) {
      const damage = mob.burnStacks * BURN_DAMAGE_PER_STACK;
      const { fatal, applied } = damageMob(zone, mob.id, damage, nowMs);
      if (applied > 0) {
        events.push({
          targetId: mob.id,
          attackerId: mob.burnLastAttackerId ?? mob.id,
          amount: applied,
          fatal,
        });
      }
      mob.burnLastTickAt = nowMs;
    }
  }
  return events;
}

/**
 * Consume every active Burn stack on a mob and return the total damage
 * value `damagePerStack × stacks`. Caller applies the damage via
 * `damageMob`. Returns 0 if the mob is unknown or carries no stacks.
 */
export function detonateBurns(
  zone: ZoneState,
  mobId: EntityId,
  damagePerStack: number
): number {
  const mob = zone.mobs.get(mobId);
  if (!mob || mob.burnStacks === 0) return 0;
  const total = mob.burnStacks * damagePerStack;
  mob.burnStacks = 0;
  mob.burnLastAttackerId = null;
  return total;
}

/**
 * Apply damage to a mob. Returns { fatal, applied } describing whether the
 * hit killed the mob and how much actually landed (clamped to remaining HP).
 * Dead mobs cannot be damaged again until they respawn.
 */
export function damageMob(
  zone: ZoneState,
  id: EntityId,
  amount: number,
  nowMs: number
): { fatal: boolean; applied: number } {
  const mob = zone.mobs.get(id);
  if (!mob || !mob.alive) return { fatal: false, applied: 0 };
  const applied = Math.min(amount, mob.hp);
  mob.hp -= applied;
  if (mob.hp <= 0) {
    mob.hp = 0;
    mob.alive = false;
    mob.respawnAt = nowMs + mob.respawnMs;
    return { fatal: true, applied };
  }
  return { fatal: false, applied };
}

/**
 * Advance mob AI: respawn any dead mobs whose timer has elapsed.
 */
export function stepMobs(zone: ZoneState, nowMs: number): void {
  for (const mob of zone.mobs.values()) {
    if (!mob.alive && mob.respawnAt !== null && nowMs >= mob.respawnAt) {
      mob.hp = mob.maxHp;
      mob.alive = true;
      mob.respawnAt = null;
      mob.pos = { ...mob.spawnPos };
    }
  }
}

function isWalkable(zone: ZoneState, pos: Vec2): boolean {
  const tx = Math.floor(pos.x);
  const ty = Math.floor(pos.y);
  if (tx < 0 || ty < 0 || tx >= zone.size.x || ty >= zone.size.y) return false;
  const row = zone.tileMap[ty];
  if (!row) return false;
  return row[tx] === 0;
}

/**
 * Stores the player's pathing target after clamping to map bounds.
 * Returns false (and leaves the target untouched) if the destination tile
 * is blocked. Real pathfinding is out of scope until post-alpha.
 */
export function setPlayerTarget(zone: ZoneState, id: PlayerId, target: Vec2): boolean {
  const player = zone.players.get(id);
  if (!player) return false;

  const clamped: Vec2 = {
    x: Math.max(0, Math.min(zone.size.x - 1, target.x)),
    y: Math.max(0, Math.min(zone.size.y - 1, target.y)),
  };

  if (!isWalkable(zone, clamped)) return false;

  player.target = clamped;
  // Manual move cancels any sticky attack target — the D2/PoE convention.
  player.attackState = { kind: 'idle' };
  return true;
}

export function stepMovement(zone: ZoneState, dtSec: number): void {
  zone.tick += 1;

  for (const player of zone.players.values()) {
    if (!player.target) continue;

    const dx = player.target.x - player.pos.x;
    const dy = player.target.y - player.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = player.speed * dtSec;

    if (dist <= step) {
      player.pos = { ...player.target };
      player.target = null;
    } else {
      player.pos = {
        x: player.pos.x + (dx / dist) * step,
        y: player.pos.y + (dy / dist) * step,
      };
    }
  }
}

export function snapshotZone(zone: ZoneState): ZoneSnapshot {
  const players: PlayerState[] = [];
  for (const p of zone.players.values()) {
    const engaged =
      p.attackState.kind === 'idle' ? null : p.attackState.targetId;
    players.push({
      id: p.id,
      characterId: p.characterId,
      name: p.name,
      pos: { ...p.pos },
      engagedTargetId: engaged,
      spirit: p.resources.spirit,
      maxSpirit: p.resources.maxSpirit,
      wrath: p.resources.wrath,
      maxWrath: p.resources.maxWrath,
    });
  }
  const mobs: MobState[] = [];
  for (const m of zone.mobs.values()) {
    mobs.push({
      id: m.id,
      kind: m.kind,
      pos: { ...m.pos },
      hp: m.hp,
      maxHp: m.maxHp,
      alive: m.alive,
      burnStacks: m.burnStacks,
    });
  }
  const groundItems: GroundItem[] = [];
  for (const g of zone.groundItems.values()) {
    groundItems.push({ id: g.id, baseId: g.baseId, pos: { ...g.pos } });
  }
  return { tick: zone.tick, players, mobs, groundItems };
}

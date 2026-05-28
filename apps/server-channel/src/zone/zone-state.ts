import type {
  PlayerId,
  CharacterId,
  EntityId,
  SkillId,
  Vec2,
  ZoneSnapshot,
  PlayerState,
  MobState,
} from '@mmo/protocol';

export type PlayerAttackState =
  | { kind: 'idle' }
  | { kind: 'chasing'; targetId: EntityId; skillId: SkillId }
  | { kind: 'in-range-attacking'; targetId: EntityId; skillId: SkillId };

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
}

export interface ZoneState {
  size: Vec2;
  tileMap: number[][];
  players: Map<PlayerId, ServerPlayer>;
  mobs: Map<EntityId, ServerMob>;
  tick: number;
}

export interface PlayerSpawnInput {
  id: PlayerId;
  characterId: CharacterId;
  name: string;
  pos?: Vec2;
  speed?: number;
}

export interface MobSpawnInput {
  id: EntityId;
  kind: string;
  pos: Vec2;
  maxHp: number;
  respawnMs?: number;
}

const DEFAULT_SPEED_TILES_PER_SEC = 4;
const DEFAULT_RESPAWN_MS = 5_000;

export function createZoneState(opts: { size: Vec2; tileMap: number[][] }): ZoneState {
  return {
    size: opts.size,
    tileMap: opts.tileMap,
    players: new Map(),
    mobs: new Map(),
    tick: 0,
  };
}

export function spawnPlayer(zone: ZoneState, input: PlayerSpawnInput): ServerPlayer {
  const pos = input.pos ?? {
    x: Math.floor(zone.size.x / 2),
    y: Math.floor(zone.size.y / 2),
  };
  const player: ServerPlayer = {
    id: input.id,
    characterId: input.characterId,
    name: input.name,
    pos: { ...pos },
    target: null,
    speed: input.speed ?? DEFAULT_SPEED_TILES_PER_SEC,
    cooldowns: new Map(),
    attackState: { kind: 'idle' },
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
  };
  zone.mobs.set(input.id, mob);
  return mob;
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
    });
  }
  return { tick: zone.tick, players, mobs };
}

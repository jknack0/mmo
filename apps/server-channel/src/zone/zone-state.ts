import type {
  PlayerId,
  CharacterId,
  Vec2,
  ZoneSnapshot,
  PlayerState,
} from '@mmo/protocol';

export interface ServerPlayer {
  id: PlayerId;
  characterId: CharacterId;
  name: string;
  pos: Vec2;
  target: Vec2 | null;
  /** Tiles per second. */
  speed: number;
}

export interface ZoneState {
  size: Vec2;
  tileMap: number[][];
  players: Map<PlayerId, ServerPlayer>;
  tick: number;
}

export interface SpawnInput {
  id: PlayerId;
  characterId: CharacterId;
  name: string;
  pos?: Vec2;
  speed?: number;
}

const DEFAULT_SPEED_TILES_PER_SEC = 4;

export function createZoneState(opts: { size: Vec2; tileMap: number[][] }): ZoneState {
  return {
    size: opts.size,
    tileMap: opts.tileMap,
    players: new Map(),
    tick: 0,
  };
}

export function spawnPlayer(zone: ZoneState, input: SpawnInput): ServerPlayer {
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
  };
  zone.players.set(input.id, player);
  return player;
}

export function despawnPlayer(zone: ZoneState, id: PlayerId): void {
  zone.players.delete(id);
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
    players.push({
      id: p.id,
      characterId: p.characterId,
      name: p.name,
      pos: { ...p.pos },
    });
  }
  return { tick: zone.tick, players };
}

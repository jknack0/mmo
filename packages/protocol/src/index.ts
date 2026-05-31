// Wire protocol shared between client and channel.
//
// JSON dev mode by default per PROTOTYPE_NOTES.md lesson #4 — the binary
// replacement lands in S23 (#25). Encoder/decoder helpers wrap the
// `JSON.stringify`/`JSON.parse` round-trip so call sites stay swap-ready.

export type PlayerId = string;
export type CharacterId = string;
export type EntityId = string;
export type SkillId = string;

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerState {
  id: PlayerId;
  characterId: CharacterId;
  name: string;
  pos: Vec2;
  /** Target this player is currently sticky-attacking, if any. */
  engagedTargetId: EntityId | null;
  /** ADR-0010: fast-regenerating spam resource. */
  spirit: number;
  maxSpirit: number;
  /** ADR-0010: combat-built ultimate resource. */
  wrath: number;
  maxWrath: number;
  /** Current health (S16 pulls player HP forward). */
  hp: number;
  maxHp: number;
}

export interface MobState {
  id: EntityId;
  kind: string;
  pos: Vec2;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Pyromancy Burn DoT stacks visible to the client. */
  burnStacks?: number;
}

/** A dropped item lying in the world, awaiting pickup (S13/S14). */
export interface GroundItem {
  /** Server-issued item UUID (ADR-0013). */
  id: EntityId;
  baseId: string;
  pos: Vec2;
  /** Rarity tier ('white'|'blue'|'yellow'|'gold') for constant-color rendering. */
  rarity: string;
}

/** A static town NPC (vendor / trainer / rift-portal), sent on welcome (S17). */
export interface WorldNpc {
  id: string;
  kind: string;
  pos: Vec2;
  label: string;
}

/** A zone-exit portal, sent on welcome (S17). Stepping on it hands off zones. */
export interface WorldPortal {
  id: string;
  pos: Vec2;
  targetZoneId: string;
  label: string;
}

export interface ZoneSnapshot {
  tick: number;
  players: PlayerState[];
  mobs: MobState[];
  groundItems: GroundItem[];
}

// ─── Client → Channel ───────────────────────────────────────────

export type ClientMessage =
  | { type: 'hello'; sessionToken: string; characterId: CharacterId; name: string }
  | { type: 'move'; target: Vec2 }
  | { type: 'attack'; targetId: EntityId; skillId: SkillId }
  | { type: 'dodge' }
  | { type: 'pickup'; itemId: EntityId }
  | { type: 'use-item'; itemId: EntityId };

// ─── Channel → Client ───────────────────────────────────────────

export interface DamageEvent {
  targetId: EntityId;
  attackerId: PlayerId;
  amount: number;
  fatal: boolean;
  /** Skill that dealt this damage, for per-skill client VFX. 'burn' = DoT tick. */
  skillId?: SkillId;
}

// Optional: PlayerState.engagedTargetId may be omitted by older snapshots
// during the migration window; decoder normalises to null in that case.

export type ServerMessage =
  | {
      type: 'welcome';
      you: PlayerId;
      zoneId: string;
      zoneSize: Vec2;
      tileMap: number[][];
      npcs: WorldNpc[];
      portals: WorldPortal[];
    }
  | { type: 'zone-transition'; zoneId: string }
  | { type: 'snapshot'; snapshot: ZoneSnapshot }
  | { type: 'damage'; event: DamageEvent }
  | { type: 'picked-up'; itemId: EntityId; baseId: string }
  | { type: 'consumed'; itemId: EntityId; heal: number }
  | { type: 'error'; reason: string };

// ─── Gateway HTTP shapes ────────────────────────────────────────

export interface GatewayConnectResponse {
  wsUrl: string;
  channelId: string;
}

// ─── Encoders ───────────────────────────────────────────────────

function isVec2(v: unknown): v is Vec2 {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Vec2).x === 'number' &&
    typeof (v as Vec2).y === 'number'
  );
}

export function encodeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

export function decodeClientMessage(raw: string): ClientMessage {
  const parsed = JSON.parse(raw) as { type?: string } & Record<string, unknown>;
  switch (parsed.type) {
    case 'hello':
      if (
        typeof parsed.sessionToken !== 'string' ||
        typeof parsed.characterId !== 'string' ||
        typeof parsed.name !== 'string'
      ) {
        throw new Error('protocol: malformed hello');
      }
      return {
        type: 'hello',
        sessionToken: parsed.sessionToken,
        characterId: parsed.characterId,
        name: parsed.name,
      };
    case 'move':
      if (!isVec2(parsed.target)) {
        throw new Error('protocol: malformed move');
      }
      return { type: 'move', target: parsed.target };
    case 'attack':
      if (typeof parsed.targetId !== 'string' || typeof parsed.skillId !== 'string') {
        throw new Error('protocol: malformed attack');
      }
      return { type: 'attack', targetId: parsed.targetId, skillId: parsed.skillId };
    case 'dodge':
      return { type: 'dodge' };
    case 'pickup':
      if (typeof parsed.itemId !== 'string') {
        throw new Error('protocol: malformed pickup');
      }
      return { type: 'pickup', itemId: parsed.itemId };
    case 'use-item':
      if (typeof parsed.itemId !== 'string') {
        throw new Error('protocol: malformed use-item');
      }
      return { type: 'use-item', itemId: parsed.itemId };
    default:
      throw new Error(`protocol: unknown client message type "${parsed.type}"`);
  }
}

export function encodeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeServerMessage(raw: string): ServerMessage {
  const parsed = JSON.parse(raw) as { type?: string } & Record<string, unknown>;
  switch (parsed.type) {
    case 'welcome':
      if (
        typeof parsed.you !== 'string' ||
        !isVec2(parsed.zoneSize) ||
        !Array.isArray(parsed.tileMap)
      ) {
        throw new Error('protocol: malformed welcome');
      }
      return {
        type: 'welcome',
        you: parsed.you,
        zoneId: typeof parsed.zoneId === 'string' ? parsed.zoneId : '',
        zoneSize: parsed.zoneSize,
        tileMap: parsed.tileMap as number[][],
        npcs: Array.isArray(parsed.npcs) ? (parsed.npcs as WorldNpc[]) : [],
        portals: Array.isArray(parsed.portals) ? (parsed.portals as WorldPortal[]) : [],
      };
    case 'zone-transition':
      if (typeof parsed.zoneId !== 'string') {
        throw new Error('protocol: malformed zone-transition');
      }
      return { type: 'zone-transition', zoneId: parsed.zoneId };
    case 'snapshot': {
      if (typeof parsed.snapshot !== 'object' || parsed.snapshot === null) {
        throw new Error('protocol: malformed snapshot');
      }
      const snap = parsed.snapshot as ZoneSnapshot;
      // Tolerate snapshots from before groundItems existed.
      if (!Array.isArray(snap.groundItems)) snap.groundItems = [];
      return { type: 'snapshot', snapshot: snap };
    }
    case 'damage': {
      const ev = parsed.event;
      if (
        typeof ev !== 'object' ||
        ev === null ||
        typeof (ev as DamageEvent).targetId !== 'string' ||
        typeof (ev as DamageEvent).attackerId !== 'string' ||
        typeof (ev as DamageEvent).amount !== 'number' ||
        typeof (ev as DamageEvent).fatal !== 'boolean'
      ) {
        throw new Error('protocol: malformed damage');
      }
      return { type: 'damage', event: ev as DamageEvent };
    }
    case 'picked-up':
      if (typeof parsed.itemId !== 'string' || typeof parsed.baseId !== 'string') {
        throw new Error('protocol: malformed picked-up');
      }
      return { type: 'picked-up', itemId: parsed.itemId, baseId: parsed.baseId };
    case 'consumed':
      if (typeof parsed.itemId !== 'string' || typeof parsed.heal !== 'number') {
        throw new Error('protocol: malformed consumed');
      }
      return { type: 'consumed', itemId: parsed.itemId, heal: parsed.heal };
    case 'error':
      if (typeof parsed.reason !== 'string') {
        throw new Error('protocol: malformed error');
      }
      return { type: 'error', reason: parsed.reason };
    default:
      throw new Error(`protocol: unknown server message type "${parsed.type}"`);
  }
}

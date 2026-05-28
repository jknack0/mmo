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
}

export interface MobState {
  id: EntityId;
  kind: string;
  pos: Vec2;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export interface ZoneSnapshot {
  tick: number;
  players: PlayerState[];
  mobs: MobState[];
}

// ─── Client → Channel ───────────────────────────────────────────

export type ClientMessage =
  | { type: 'hello'; sessionToken: string; characterId: CharacterId; name: string }
  | { type: 'move'; target: Vec2 }
  | { type: 'attack'; targetId: EntityId; skillId: SkillId };

// ─── Channel → Client ───────────────────────────────────────────

export interface DamageEvent {
  targetId: EntityId;
  attackerId: PlayerId;
  amount: number;
  fatal: boolean;
}

// Optional: PlayerState.engagedTargetId may be omitted by older snapshots
// during the migration window; decoder normalises to null in that case.

export type ServerMessage =
  | { type: 'welcome'; you: PlayerId; zoneSize: Vec2; tileMap: number[][] }
  | { type: 'snapshot'; snapshot: ZoneSnapshot }
  | { type: 'damage'; event: DamageEvent }
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
        zoneSize: parsed.zoneSize,
        tileMap: parsed.tileMap as number[][],
      };
    case 'snapshot':
      if (typeof parsed.snapshot !== 'object' || parsed.snapshot === null) {
        throw new Error('protocol: malformed snapshot');
      }
      return { type: 'snapshot', snapshot: parsed.snapshot as ZoneSnapshot };
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
    case 'error':
      if (typeof parsed.reason !== 'string') {
        throw new Error('protocol: malformed error');
      }
      return { type: 'error', reason: parsed.reason };
    default:
      throw new Error(`protocol: unknown server message type "${parsed.type}"`);
  }
}

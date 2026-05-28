// Wire protocol shared between client and channel.
//
// JSON dev mode by default per PROTOTYPE_NOTES.md lesson #4 — the binary
// replacement lands in S23 (#25). Encoder/decoder helpers wrap the
// `JSON.stringify`/`JSON.parse` round-trip so call sites stay swap-ready.

export type PlayerId = string;
export type CharacterId = string;
export type EntityId = string;

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerState {
  id: PlayerId;
  characterId: CharacterId;
  name: string;
  pos: Vec2;
}

export interface ZoneSnapshot {
  tick: number;
  players: PlayerState[];
}

// ─── Client → Channel ───────────────────────────────────────────

export type ClientMessage =
  | { type: 'hello'; sessionToken: string; characterId: CharacterId; name: string }
  | { type: 'move'; target: Vec2 };

// ─── Channel → Client ───────────────────────────────────────────

export type ServerMessage =
  | { type: 'welcome'; you: PlayerId; zoneSize: Vec2; tileMap: number[][] }
  | { type: 'snapshot'; snapshot: ZoneSnapshot }
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
    case 'error':
      if (typeof parsed.reason !== 'string') {
        throw new Error('protocol: malformed error');
      }
      return { type: 'error', reason: parsed.reason };
    default:
      throw new Error(`protocol: unknown server message type "${parsed.type}"`);
  }
}

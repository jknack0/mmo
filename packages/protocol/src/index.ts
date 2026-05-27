// SPIKE: JSON message types shared between client and channel.
// Real implementation per ADR-0012 will be binary; JSON here for debuggability.

export type PlayerId = string;
export type EntityId = string;

export interface Vec2 {
  x: number;
  y: number;
}

// ─── Client → Channel ─────────────────────────────────────────────

export type ClientMessage =
  | { type: 'hello'; token: string; name: string }
  | { type: 'move'; target: Vec2 }
  | { type: 'attack'; targetId: EntityId };

// ─── Channel → Client ─────────────────────────────────────────────

export interface PlayerState {
  id: PlayerId;
  name: string;
  pos: Vec2;
  target: Vec2 | null;
  hp: number;
  maxHp: number;
}

export interface MobState {
  id: EntityId;
  kind: 'skeleton';
  pos: Vec2;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnAt: number | null;
}

export interface ZoneSnapshot {
  tick: number;
  players: PlayerState[];
  mobs: MobState[];
}

export interface DamageEvent {
  targetId: EntityId;
  amount: number;
  attackerId: PlayerId;
}

export type ServerMessage =
  | { type: 'welcome'; you: PlayerId; zoneSize: Vec2 }
  | { type: 'snapshot'; snapshot: ZoneSnapshot }
  | { type: 'damage'; event: DamageEvent }
  | { type: 'error'; reason: string };

// ─── Gateway HTTP ─────────────────────────────────────────────────

export interface GatewayConnectResponse {
  channelUrl: string;
  playerId: PlayerId;
  token: string;
}

// Wire protocol shared between client and channel.
//
// S23 (#25): binary is the production wire format (ADR-0012). Each frame leads
// with a magic byte; the JSON encoding is preserved behind a dev flag for
// debuggability. The decoder self-describes off the magic byte, so binary and
// JSON peers interoperate during a migration.

import {
  ByteWriter,
  ByteReader,
  toBytes,
  utf8,
  MAGIC_BINARY,
  MAGIC_JSON,
} from './binary.js';

// ─── Dev-mode flag (JSON wire) ──────────────────────────────────
// On = encoders emit JSON frames (decoders always accept both). Defaults from
// the PROTO_JSON env var where a process exists (server); off in the browser.
let jsonMode =
  typeof process !== 'undefined' && !!process.env && process.env.PROTO_JSON === '1';

/** Toggle the JSON dev wire format at runtime. Decoding is unaffected. */
export function setJsonProtocol(on: boolean): void {
  jsonMode = on;
}
export function isJsonProtocol(): boolean {
  return jsonMode;
}

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
  /** Dead state (S18): HP hit 0, awaiting respawn. Replicated to all clients. */
  dead: boolean;
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
  | { type: 'hello'; sessionToken: string; characterId: CharacterId; name: string; instanceId?: string }
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
      /** Instance id for instanced zones (Rifts, S19); '' for shared zones. */
      instanceId: string;
      zoneSize: Vec2;
      tileMap: number[][];
      npcs: WorldNpc[];
      portals: WorldPortal[];
    }
  | { type: 'zone-transition'; zoneId: string }
  | { type: 'rift-status'; phase: string; kills: number; quota: number; deaths: number; maxDeaths: number }
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

function encodeClientJson(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

function decodeClientJson(raw: string): ClientMessage {
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
        ...(typeof parsed.instanceId === 'string' ? { instanceId: parsed.instanceId } : {}),
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

function encodeServerJson(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

function decodeServerJson(raw: string): ServerMessage {
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
        instanceId: typeof parsed.instanceId === 'string' ? parsed.instanceId : '',
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
    case 'rift-status':
      if (
        typeof parsed.phase !== 'string' ||
        typeof parsed.kills !== 'number' ||
        typeof parsed.quota !== 'number'
      ) {
        throw new Error('protocol: malformed rift-status');
      }
      return {
        type: 'rift-status',
        phase: parsed.phase,
        kills: parsed.kills,
        quota: parsed.quota,
        deaths: typeof parsed.deaths === 'number' ? parsed.deaths : 0,
        maxDeaths: typeof parsed.maxDeaths === 'number' ? parsed.maxDeaths : 0,
      };
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

// ─── Binary codec (S23) ─────────────────────────────────────────
// Message-type tags (u8, follow the magic byte).
const C_HELLO = 1, C_MOVE = 2, C_ATTACK = 3, C_DODGE = 4, C_PICKUP = 5, C_USE_ITEM = 6;
const S_WELCOME = 1, S_ZONE_TRANSITION = 2, S_RIFT_STATUS = 3, S_SNAPSHOT = 4,
  S_DAMAGE = 5, S_PICKED_UP = 6, S_CONSUMED = 7, S_ERROR = 8;

function writeVec2(w: ByteWriter, v: Vec2): void {
  w.f32(v.x);
  w.f32(v.y);
}
function readVec2(r: ByteReader): Vec2 {
  return { x: r.f32(), y: r.f32() };
}

function writePlayer(w: ByteWriter, p: PlayerState): void {
  w.str(p.id);
  w.str(p.characterId);
  w.str(p.name);
  writeVec2(w, p.pos);
  w.bool(p.engagedTargetId !== null);
  if (p.engagedTargetId !== null) w.str(p.engagedTargetId);
  w.f32(p.spirit); w.f32(p.maxSpirit);
  w.f32(p.wrath); w.f32(p.maxWrath);
  w.f32(p.hp); w.f32(p.maxHp);
  w.bool(p.dead);
}
function readPlayer(r: ByteReader): PlayerState {
  const id = r.str();
  const characterId = r.str();
  const name = r.str();
  const pos = readVec2(r);
  const engagedTargetId = r.bool() ? r.str() : null;
  const spirit = r.f32(), maxSpirit = r.f32();
  const wrath = r.f32(), maxWrath = r.f32();
  const hp = r.f32(), maxHp = r.f32();
  const dead = r.bool();
  return { id, characterId, name, pos, engagedTargetId, spirit, maxSpirit, wrath, maxWrath, hp, maxHp, dead };
}

function writeMob(w: ByteWriter, m: MobState): void {
  w.str(m.id);
  w.str(m.kind);
  writeVec2(w, m.pos);
  w.f32(m.hp); w.f32(m.maxHp);
  w.bool(m.alive);
  w.varuint(m.burnStacks ?? 0);
}
function readMob(r: ByteReader): MobState {
  const id = r.str();
  const kind = r.str();
  const pos = readVec2(r);
  const hp = r.f32(), maxHp = r.f32();
  const alive = r.bool();
  const burnStacks = r.varuint();
  return { id, kind, pos, hp, maxHp, alive, ...(burnStacks ? { burnStacks } : {}) };
}

function writeGround(w: ByteWriter, g: GroundItem): void {
  w.str(g.id); w.str(g.baseId); writeVec2(w, g.pos); w.str(g.rarity);
}
function readGround(r: ByteReader): GroundItem {
  return { id: r.str(), baseId: r.str(), pos: readVec2(r), rarity: r.str() };
}

function writeArray<T>(w: ByteWriter, items: T[], each: (w: ByteWriter, t: T) => void): void {
  w.varuint(items.length);
  for (const it of items) each(w, it);
}
function readArray<T>(r: ByteReader, each: (r: ByteReader) => T): T[] {
  const n = r.varuint();
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(each(r));
  return out;
}

function packClient(w: ByteWriter, msg: ClientMessage): void {
  switch (msg.type) {
    case 'hello':
      w.u8(C_HELLO);
      w.str(msg.sessionToken); w.str(msg.characterId); w.str(msg.name);
      w.bool(msg.instanceId !== undefined);
      if (msg.instanceId !== undefined) w.str(msg.instanceId);
      return;
    case 'move': w.u8(C_MOVE); writeVec2(w, msg.target); return;
    case 'attack': w.u8(C_ATTACK); w.str(msg.targetId); w.str(msg.skillId); return;
    case 'dodge': w.u8(C_DODGE); return;
    case 'pickup': w.u8(C_PICKUP); w.str(msg.itemId); return;
    case 'use-item': w.u8(C_USE_ITEM); w.str(msg.itemId); return;
  }
}
function unpackClient(r: ByteReader): ClientMessage {
  const tag = r.u8();
  switch (tag) {
    case C_HELLO: {
      const sessionToken = r.str(), characterId = r.str(), name = r.str();
      const hasInstance = r.bool();
      return { type: 'hello', sessionToken, characterId, name, ...(hasInstance ? { instanceId: r.str() } : {}) };
    }
    case C_MOVE: return { type: 'move', target: readVec2(r) };
    case C_ATTACK: return { type: 'attack', targetId: r.str(), skillId: r.str() };
    case C_DODGE: return { type: 'dodge' };
    case C_PICKUP: return { type: 'pickup', itemId: r.str() };
    case C_USE_ITEM: return { type: 'use-item', itemId: r.str() };
    default: throw new Error(`protocol: unknown binary client tag ${tag}`);
  }
}

function packServer(w: ByteWriter, msg: ServerMessage): void {
  switch (msg.type) {
    case 'welcome':
      w.u8(S_WELCOME);
      w.str(msg.you); w.str(msg.zoneId); w.str(msg.instanceId);
      writeVec2(w, msg.zoneSize);
      w.varuint(msg.tileMap.length);
      w.varuint(msg.tileMap[0]?.length ?? 0);
      for (const row of msg.tileMap) for (const cell of row) w.u8(cell);
      writeArray(w, msg.npcs, (ww, n) => { ww.str(n.id); ww.str(n.kind); writeVec2(ww, n.pos); ww.str(n.label); });
      writeArray(w, msg.portals, (ww, p) => { ww.str(p.id); writeVec2(ww, p.pos); ww.str(p.targetZoneId); ww.str(p.label); });
      return;
    case 'zone-transition': w.u8(S_ZONE_TRANSITION); w.str(msg.zoneId); return;
    case 'rift-status':
      w.u8(S_RIFT_STATUS);
      w.str(msg.phase); w.varuint(msg.kills); w.varuint(msg.quota); w.varuint(msg.deaths); w.varuint(msg.maxDeaths);
      return;
    case 'snapshot':
      w.u8(S_SNAPSHOT);
      w.varuint(msg.snapshot.tick);
      writeArray(w, msg.snapshot.players, writePlayer);
      writeArray(w, msg.snapshot.mobs, writeMob);
      writeArray(w, msg.snapshot.groundItems, writeGround);
      return;
    case 'damage':
      w.u8(S_DAMAGE);
      w.str(msg.event.targetId); w.str(msg.event.attackerId); w.f32(msg.event.amount); w.bool(msg.event.fatal);
      w.bool(msg.event.skillId !== undefined);
      if (msg.event.skillId !== undefined) w.str(msg.event.skillId);
      return;
    case 'picked-up': w.u8(S_PICKED_UP); w.str(msg.itemId); w.str(msg.baseId); return;
    case 'consumed': w.u8(S_CONSUMED); w.str(msg.itemId); w.f32(msg.heal); return;
    case 'error': w.u8(S_ERROR); w.str(msg.reason); return;
  }
}
function unpackServer(r: ByteReader): ServerMessage {
  const tag = r.u8();
  switch (tag) {
    case S_WELCOME: {
      const you = r.str(), zoneId = r.str(), instanceId = r.str();
      const zoneSize = readVec2(r);
      const rows = r.varuint(), cols = r.varuint();
      const tileMap: number[][] = [];
      for (let y = 0; y < rows; y++) {
        const row: number[] = [];
        for (let x = 0; x < cols; x++) row.push(r.u8());
        tileMap.push(row);
      }
      const npcs = readArray(r, (rr) => ({ id: rr.str(), kind: rr.str(), pos: readVec2(rr), label: rr.str() }));
      const portals = readArray(r, (rr) => ({ id: rr.str(), pos: readVec2(rr), targetZoneId: rr.str(), label: rr.str() }));
      return { type: 'welcome', you, zoneId, instanceId, zoneSize, tileMap, npcs, portals };
    }
    case S_ZONE_TRANSITION: return { type: 'zone-transition', zoneId: r.str() };
    case S_RIFT_STATUS:
      return { type: 'rift-status', phase: r.str(), kills: r.varuint(), quota: r.varuint(), deaths: r.varuint(), maxDeaths: r.varuint() };
    case S_SNAPSHOT: {
      const tick = r.varuint();
      const players = readArray(r, readPlayer);
      const mobs = readArray(r, readMob);
      const groundItems = readArray(r, readGround);
      return { type: 'snapshot', snapshot: { tick, players, mobs, groundItems } };
    }
    case S_DAMAGE: {
      const targetId = r.str(), attackerId = r.str(), amount = r.f32(), fatal = r.bool();
      const hasSkill = r.bool();
      return { type: 'damage', event: { targetId, attackerId, amount, fatal, ...(hasSkill ? { skillId: r.str() } : {}) } };
    }
    case S_PICKED_UP: return { type: 'picked-up', itemId: r.str(), baseId: r.str() };
    case S_CONSUMED: return { type: 'consumed', itemId: r.str(), heal: r.f32() };
    case S_ERROR: return { type: 'error', reason: r.str() };
    default: throw new Error(`protocol: unknown binary server tag ${tag}`);
  }
}

// ─── Public envelope: binary by default, JSON behind the dev flag ───
type WireInput = Uint8Array | ArrayBuffer | ArrayBufferView | string;

function jsonFrame(json: string): Uint8Array {
  const body = new TextEncoder().encode(json);
  const out = new Uint8Array(body.length + 1);
  out[0] = MAGIC_JSON;
  out.set(body, 1);
  return out;
}

/** Returns the JSON string when a frame is JSON-encoded, else null (binary). */
function asJson(raw: WireInput): string | null {
  if (typeof raw === 'string') return raw; // legacy: a bare JSON string
  const bytes = toBytes(raw);
  const magic = bytes[0];
  if (magic === MAGIC_BINARY) return null;
  if (magic === MAGIC_JSON) return utf8(bytes.subarray(1));
  return utf8(bytes); // legacy raw-JSON frame ('{' …) or anything non-binary
}

export function encodeClientMessage(msg: ClientMessage): Uint8Array {
  if (jsonMode) return jsonFrame(encodeClientJson(msg));
  const w = new ByteWriter();
  packClient(w, msg);
  return w.finish(MAGIC_BINARY);
}

export function decodeClientMessage(raw: WireInput): ClientMessage {
  const json = asJson(raw);
  if (json !== null) return decodeClientJson(json);
  return unpackClient(new ByteReader(toBytes(raw as Uint8Array), 1));
}

export function encodeServerMessage(msg: ServerMessage): Uint8Array {
  if (jsonMode) return jsonFrame(encodeServerJson(msg));
  const w = new ByteWriter();
  packServer(w, msg);
  return w.finish(MAGIC_BINARY);
}

export function decodeServerMessage(raw: WireInput): ServerMessage {
  const json = asJson(raw);
  if (json !== null) return decodeServerJson(json);
  return unpackServer(new ByteReader(toBytes(raw as Uint8Array), 1));
}

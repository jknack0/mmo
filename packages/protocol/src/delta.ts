// Delta-encoded snapshots (S24 #26, PROTOTYPE_NOTES.md lesson #3).
//
// Full-state-every-tick does not survive 50 players. Instead the channel sends
// periodic KEYFRAMES (full state) and, between them, DELTAS carrying only the
// entity fields that changed since the previous frame. Entities are referenced
// by a small per-zone integer HANDLE (not their 36-byte UUID) so a moving
// player costs ~handle+mask+pos bytes instead of a full record — the bulk of
// the ≥80% bandwidth win.
//
// This module is pure: compute a delta from two handled frames, apply a delta
// to a reconstructed state, and flatten a handled state back to a ZoneSnapshot.

import type { PlayerState, MobState, GroundItem, ZoneSnapshot, Vec2, EntityId, ServerMessage } from './index.js';

export type Handle = number;

/** A full frame keyed by handle — the keyframe payload + the reconstruction state. */
export interface HandledFrame {
  tick: number;
  players: Map<Handle, PlayerState>;
  mobs: Map<Handle, MobState>;
  ground: Map<Handle, GroundItem>;
}

// ─── Field masks ────────────────────────────────────────────────
export const PF = {
  POS: 1, ENGAGED: 2, SPIRIT: 4, WRATH: 8, HP: 16, DEAD: 32, MAXES: 64, IDENTITY: 128,
} as const;
export const MF = {
  POS: 1, HP: 2, ALIVE: 4, BURN: 8, MAXHP: 16, KIND: 32,
} as const;

export interface PlayerDelta {
  h: Handle; mask: number;
  pos?: Vec2; engagedTargetId?: EntityId | null;
  spirit?: number; wrath?: number; hp?: number; dead?: boolean;
  maxSpirit?: number; maxWrath?: number; maxHp?: number;
  name?: string; characterId?: string;
}
export interface MobDelta {
  h: Handle; mask: number;
  pos?: Vec2; hp?: number; alive?: boolean; burnStacks?: number; maxHp?: number; kind?: string;
}

export interface SnapshotDelta {
  baseTick: number;
  tick: number;
  players: PlayerDelta[];
  removedPlayers: Handle[];
  mobs: MobDelta[];
  removedMobs: Handle[];
  /** Ground items don't move — added items are sent whole, gone ones removed. */
  groundAdded: Array<{ h: Handle } & GroundItem>;
  removedGround: Handle[];
}

const vecEq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

function playerDelta(h: Handle, prev: PlayerState | undefined, next: PlayerState): PlayerDelta | null {
  let mask = 0;
  const d: PlayerDelta = { h, mask: 0 };
  if (!prev || !vecEq(prev.pos, next.pos)) { mask |= PF.POS; d.pos = { x: next.pos.x, y: next.pos.y }; }
  if (!prev || prev.engagedTargetId !== next.engagedTargetId) { mask |= PF.ENGAGED; d.engagedTargetId = next.engagedTargetId; }
  if (!prev || prev.spirit !== next.spirit) { mask |= PF.SPIRIT; d.spirit = next.spirit; }
  if (!prev || prev.wrath !== next.wrath) { mask |= PF.WRATH; d.wrath = next.wrath; }
  if (!prev || prev.hp !== next.hp) { mask |= PF.HP; d.hp = next.hp; }
  if (!prev || prev.dead !== next.dead) { mask |= PF.DEAD; d.dead = next.dead; }
  if (!prev || prev.maxSpirit !== next.maxSpirit || prev.maxWrath !== next.maxWrath || prev.maxHp !== next.maxHp) {
    mask |= PF.MAXES; d.maxSpirit = next.maxSpirit; d.maxWrath = next.maxWrath; d.maxHp = next.maxHp;
  }
  if (!prev || prev.name !== next.name || prev.characterId !== next.characterId) {
    mask |= PF.IDENTITY; d.name = next.name; d.characterId = next.characterId;
  }
  if (mask === 0) return null;
  d.mask = mask;
  return d;
}

function mobDelta(h: Handle, prev: MobState | undefined, next: MobState): MobDelta | null {
  let mask = 0;
  const d: MobDelta = { h, mask: 0 };
  if (!prev || !vecEq(prev.pos, next.pos)) { mask |= MF.POS; d.pos = { x: next.pos.x, y: next.pos.y }; }
  if (!prev || prev.hp !== next.hp) { mask |= MF.HP; d.hp = next.hp; }
  if (!prev || prev.alive !== next.alive) { mask |= MF.ALIVE; d.alive = next.alive; }
  if (!prev || (prev.burnStacks ?? 0) !== (next.burnStacks ?? 0)) { mask |= MF.BURN; d.burnStacks = next.burnStacks ?? 0; }
  if (!prev || prev.maxHp !== next.maxHp) { mask |= MF.MAXHP; d.maxHp = next.maxHp; }
  if (!prev || prev.kind !== next.kind) { mask |= MF.KIND; d.kind = next.kind; }
  if (mask === 0) return null;
  d.mask = mask;
  return d;
}

/** Diff two handled frames into a delta (only changed fields + removed handles). */
export function computeSnapshotDelta(prev: HandledFrame, next: HandledFrame): SnapshotDelta {
  const players: PlayerDelta[] = [];
  for (const [h, p] of next.players) {
    const d = playerDelta(h, prev.players.get(h), p);
    if (d) players.push(d);
  }
  const removedPlayers: Handle[] = [];
  for (const h of prev.players.keys()) if (!next.players.has(h)) removedPlayers.push(h);

  const mobs: MobDelta[] = [];
  for (const [h, m] of next.mobs) {
    const d = mobDelta(h, prev.mobs.get(h), m);
    if (d) mobs.push(d);
  }
  const removedMobs: Handle[] = [];
  for (const h of prev.mobs.keys()) if (!next.mobs.has(h)) removedMobs.push(h);

  const groundAdded: Array<{ h: Handle } & GroundItem> = [];
  for (const [h, g] of next.ground) if (!prev.ground.has(h)) groundAdded.push({ h, ...g });
  const removedGround: Handle[] = [];
  for (const h of prev.ground.keys()) if (!next.ground.has(h)) removedGround.push(h);

  return { baseTick: prev.tick, tick: next.tick, players, removedPlayers, mobs, removedMobs, groundAdded, removedGround };
}

function applyPlayerDelta(base: PlayerState | undefined, d: PlayerDelta): PlayerState {
  const p: PlayerState = base
    ? { ...base, pos: { ...base.pos } }
    : { id: '', characterId: '', name: '', pos: { x: 0, y: 0 }, engagedTargetId: null,
        spirit: 0, maxSpirit: 0, wrath: 0, maxWrath: 0, hp: 0, maxHp: 0, dead: false };
  if (d.mask & PF.POS && d.pos) p.pos = { x: d.pos.x, y: d.pos.y };
  if (d.mask & PF.ENGAGED) p.engagedTargetId = d.engagedTargetId ?? null;
  if (d.mask & PF.SPIRIT) p.spirit = d.spirit!;
  if (d.mask & PF.WRATH) p.wrath = d.wrath!;
  if (d.mask & PF.HP) p.hp = d.hp!;
  if (d.mask & PF.DEAD) p.dead = d.dead!;
  if (d.mask & PF.MAXES) { p.maxSpirit = d.maxSpirit!; p.maxWrath = d.maxWrath!; p.maxHp = d.maxHp!; }
  if (d.mask & PF.IDENTITY) { p.name = d.name!; p.characterId = d.characterId!; }
  return p;
}

function applyMobDelta(base: MobState | undefined, d: MobDelta): MobState {
  const m: MobState = base
    ? { ...base, pos: { ...base.pos } }
    : { id: '', kind: '', pos: { x: 0, y: 0 }, hp: 0, maxHp: 0, alive: true };
  if (d.mask & MF.POS && d.pos) m.pos = { x: d.pos.x, y: d.pos.y };
  if (d.mask & MF.HP) m.hp = d.hp!;
  if (d.mask & MF.ALIVE) m.alive = d.alive!;
  if (d.mask & MF.BURN) { if (d.burnStacks) m.burnStacks = d.burnStacks; else delete m.burnStacks; }
  if (d.mask & MF.MAXHP) m.maxHp = d.maxHp!;
  if (d.mask & MF.KIND) m.kind = d.kind!;
  return m;
}

/** Apply a delta onto a reconstructed frame, returning the next frame (pure). */
export function applySnapshotDelta(base: HandledFrame, delta: SnapshotDelta): HandledFrame {
  const players = new Map(base.players);
  for (const h of delta.removedPlayers) players.delete(h);
  for (const d of delta.players) players.set(d.h, applyPlayerDelta(players.get(d.h), d));

  const mobs = new Map(base.mobs);
  for (const h of delta.removedMobs) mobs.delete(h);
  for (const d of delta.mobs) mobs.set(d.h, applyMobDelta(mobs.get(d.h), d));

  const ground = new Map(base.ground);
  for (const h of delta.removedGround) ground.delete(h);
  for (const g of delta.groundAdded) { const { h, ...item } = g; ground.set(h, item); }

  return { tick: delta.tick, players, mobs, ground };
}

/** Flatten a handled frame to the wire-facing ZoneSnapshot (handles dropped). */
export function frameToSnapshot(frame: HandledFrame): ZoneSnapshot {
  return {
    tick: frame.tick,
    players: [...frame.players.values()],
    mobs: [...frame.mobs.values()],
    groundItems: [...frame.ground.values()],
  };
}

export function emptyFrame(tick = 0): HandledFrame {
  return { tick, players: new Map(), mobs: new Map(), ground: new Map() };
}

/**
 * Reconstructs a full ZoneSnapshot stream from keyframe + delta messages (S24).
 * A keyframe resets the handle map; deltas mutate it. A plain `snapshot` message
 * (e.g. from the Rift server, which doesn't delta-encode) passes straight
 * through. Other message types return null. Stateful — one per connection.
 */
export interface SnapshotReconstructor {
  ingest(msg: ServerMessage): ZoneSnapshot | null;
}

export function createSnapshotReconstructor(): SnapshotReconstructor {
  let frame: HandledFrame = emptyFrame();
  let primed = false;
  return {
    ingest(msg) {
      if (msg.type === 'keyframe') {
        const f = emptyFrame(msg.tick);
        for (const p of msg.players) { const { h, ...rest } = p; f.players.set(h, rest); }
        for (const m of msg.mobs) { const { h, ...rest } = m; f.mobs.set(h, rest); }
        for (const g of msg.ground) { const { h, ...rest } = g; f.ground.set(h, rest); }
        frame = f;
        primed = true;
        return frameToSnapshot(frame);
      }
      if (msg.type === 'delta') {
        if (!primed) return null; // no baseline yet — wait for a keyframe
        frame = applySnapshotDelta(frame, msg.delta);
        return frameToSnapshot(frame);
      }
      if (msg.type === 'snapshot') return msg.snapshot; // un-delta'd stream (Rift)
      return null;
    },
  };
}

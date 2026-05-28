// Buffers incoming ZoneSnapshots and smooths per-entity render positions
// between them via exponential lerp — the same convergence pattern the
// validated spike used (PROTOTYPE_NOTES.md). Pure logic, no side effects.

import type { Vec2, ZoneSnapshot, PlayerState, MobState } from '@mmo/protocol';

export interface InterpolatedPlayerState {
  id: string;
  characterId: string;
  name: string;
  pos: Vec2;
  engagedTargetId: string | null;
}

export interface InterpolatedMobState {
  id: string;
  kind: string;
  pos: Vec2;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export interface InterpolatedFrame {
  players: InterpolatedPlayerState[];
  mobs: InterpolatedMobState[];
}

export interface SnapshotInterpolator {
  /** Push a freshly-received server snapshot. */
  ingest(snapshot: ZoneSnapshot): void;
  /** Advance render positions by `dtSec` and return the current frame. */
  interpolate(dtSec: number): InterpolatedFrame;
}

export interface SnapshotInterpolatorOptions {
  /** Higher value = snappier convergence to authoritative positions. */
  lerpRate: number;
}

interface TrackedPlayer {
  characterId: string;
  name: string;
  target: Vec2;
  render: Vec2;
  engagedTargetId: string | null;
}

interface TrackedMob {
  kind: string;
  target: Vec2;
  render: Vec2;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export function createSnapshotInterpolator(
  opts: SnapshotInterpolatorOptions
): SnapshotInterpolator {
  const players = new Map<string, TrackedPlayer>();
  const mobs = new Map<string, TrackedMob>();

  return {
    ingest(snapshot) {
      const seenP = new Set<string>();
      for (const p of snapshot.players as PlayerState[]) {
        seenP.add(p.id);
        const existing = players.get(p.id);
        if (existing) {
          existing.target = { ...p.pos };
          existing.name = p.name;
          existing.engagedTargetId = p.engagedTargetId ?? null;
        } else {
          players.set(p.id, {
            characterId: p.characterId,
            name: p.name,
            target: { ...p.pos },
            render: { ...p.pos },
            engagedTargetId: p.engagedTargetId ?? null,
          });
        }
      }
      for (const id of players.keys()) if (!seenP.has(id)) players.delete(id);

      const seenM = new Set<string>();
      for (const m of (snapshot.mobs ?? []) as MobState[]) {
        seenM.add(m.id);
        const existing = mobs.get(m.id);
        if (existing) {
          existing.target = { ...m.pos };
          existing.hp = m.hp;
          existing.maxHp = m.maxHp;
          existing.alive = m.alive;
        } else {
          mobs.set(m.id, {
            kind: m.kind,
            target: { ...m.pos },
            render: { ...m.pos },
            hp: m.hp,
            maxHp: m.maxHp,
            alive: m.alive,
          });
        }
      }
      for (const id of mobs.keys()) if (!seenM.has(id)) mobs.delete(id);
    },

    interpolate(dtSec) {
      const k = 1 - Math.exp(-opts.lerpRate * dtSec);
      const outPlayers: InterpolatedPlayerState[] = [];
      for (const [id, t] of players) {
        t.render = {
          x: t.render.x + (t.target.x - t.render.x) * k,
          y: t.render.y + (t.target.y - t.render.y) * k,
        };
        outPlayers.push({
          id,
          characterId: t.characterId,
          name: t.name,
          pos: { x: t.render.x, y: t.render.y },
          engagedTargetId: t.engagedTargetId,
        });
      }
      const outMobs: InterpolatedMobState[] = [];
      for (const [id, t] of mobs) {
        t.render = {
          x: t.render.x + (t.target.x - t.render.x) * k,
          y: t.render.y + (t.target.y - t.render.y) * k,
        };
        outMobs.push({
          id,
          kind: t.kind,
          pos: { x: t.render.x, y: t.render.y },
          hp: t.hp,
          maxHp: t.maxHp,
          alive: t.alive,
        });
      }
      return { players: outPlayers, mobs: outMobs };
    },
  };
}

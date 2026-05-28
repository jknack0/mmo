// Buffers incoming ZoneSnapshots and smooths per-entity render positions
// between them via exponential lerp — the same convergence pattern the
// validated spike used (PROTOTYPE_NOTES.md). Pure logic, no side effects.

import type { Vec2, ZoneSnapshot, PlayerState } from '@mmo/protocol';

export interface InterpolatedPlayerState {
  id: string;
  characterId: string;
  name: string;
  pos: Vec2;
}

export interface SnapshotInterpolator {
  /** Push a freshly-received server snapshot. */
  ingest(snapshot: ZoneSnapshot): void;
  /** Advance render positions by `dtSec` and return the current frame. */
  interpolate(dtSec: number): InterpolatedPlayerState[];
}

export interface SnapshotInterpolatorOptions {
  /** Higher value = snappier convergence to authoritative positions. */
  lerpRate: number;
}

interface Tracked {
  characterId: string;
  name: string;
  /** Authoritative position from the latest snapshot. */
  target: Vec2;
  /** Render position used last frame. */
  render: Vec2;
}

export function createSnapshotInterpolator(
  opts: SnapshotInterpolatorOptions
): SnapshotInterpolator {
  const tracked = new Map<string, Tracked>();

  return {
    ingest(snapshot) {
      const seen = new Set<string>();
      for (const p of snapshot.players as PlayerState[]) {
        seen.add(p.id);
        const existing = tracked.get(p.id);
        if (existing) {
          existing.target = { ...p.pos };
          existing.name = p.name;
        } else {
          // New entrant: snap render to its first observed position so it
          // doesn't slide in from the origin.
          tracked.set(p.id, {
            characterId: p.characterId,
            name: p.name,
            target: { ...p.pos },
            render: { ...p.pos },
          });
        }
      }
      for (const id of tracked.keys()) {
        if (!seen.has(id)) tracked.delete(id);
      }
    },

    interpolate(dtSec) {
      const k = 1 - Math.exp(-opts.lerpRate * dtSec);
      const out: InterpolatedPlayerState[] = [];
      for (const [id, t] of tracked) {
        t.render = {
          x: t.render.x + (t.target.x - t.render.x) * k,
          y: t.render.y + (t.target.y - t.render.y) * k,
        };
        out.push({
          id,
          characterId: t.characterId,
          name: t.name,
          pos: { x: t.render.x, y: t.render.y },
        });
      }
      return out;
    },
  };
}

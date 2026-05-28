import { describe, it, expect } from 'vitest';
import type { ZoneSnapshot } from '@mmo/protocol';
import { createSnapshotInterpolator } from './snapshot-interpolator.js';

function snapshot(
  tick: number,
  players: { id: string; characterId: string; name: string; pos: { x: number; y: number } }[],
  mobs: { id: string; kind: string; pos: { x: number; y: number }; hp: number; maxHp: number; alive: boolean }[] = []
): ZoneSnapshot {
  return { tick, players, mobs };
}

describe('SnapshotInterpolator', () => {
  it('renders the first snapshot exactly with no smoothing', () => {
    const interp = createSnapshotInterpolator({ lerpRate: 12 });
    interp.ingest(snapshot(0, [{ id: 'p1', characterId: 'c1', name: 'A', pos: { x: 5, y: 5 } }]));
    const rendered = interp.interpolate(0.016);
    expect(rendered.players).toHaveLength(1);
    expect(rendered.players[0]!.pos).toEqual({ x: 5, y: 5 });
  });

  it('lerps toward a moved target across ingests', () => {
    const interp = createSnapshotInterpolator({ lerpRate: 12 });
    interp.ingest(snapshot(0, [{ id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } }]));
    interp.interpolate(0.016);
    interp.ingest(snapshot(1, [{ id: 'p1', characterId: 'c1', name: 'A', pos: { x: 10, y: 10 } }]));
    const rendered = interp.interpolate(0.1);
    expect(rendered.players[0]!.pos.x).toBeGreaterThan(0);
    expect(rendered.players[0]!.pos.x).toBeLessThan(10);
  });

  it('converges to the latest target with enough integrated dt', () => {
    const interp = createSnapshotInterpolator({ lerpRate: 12 });
    interp.ingest(snapshot(0, [{ id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } }]));
    interp.ingest(snapshot(1, [{ id: 'p1', characterId: 'c1', name: 'A', pos: { x: 5, y: 5 } }]));
    interp.interpolate(2);
    const rendered = interp.interpolate(0.016);
    expect(rendered.players[0]!.pos.x).toBeCloseTo(5, 2);
    expect(rendered.players[0]!.pos.y).toBeCloseTo(5, 2);
  });

  it('drops players that disappear from the latest snapshot', () => {
    const interp = createSnapshotInterpolator({ lerpRate: 12 });
    interp.ingest(snapshot(0, [
      { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } },
      { id: 'p2', characterId: 'c2', name: 'B', pos: { x: 5, y: 5 } },
    ]));
    interp.ingest(snapshot(1, [
      { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } },
    ]));
    const rendered = interp.interpolate(0.016);
    expect(rendered.players.map((p) => p.id)).toEqual(['p1']);
  });

  it('tracks multiple players independently', () => {
    const interp = createSnapshotInterpolator({ lerpRate: 12 });
    interp.ingest(snapshot(0, [
      { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } },
      { id: 'p2', characterId: 'c2', name: 'B', pos: { x: 10, y: 10 } },
    ]));
    const rendered = interp.interpolate(0.016);
    expect(rendered.players.find((p) => p.id === 'p1')!.pos).toEqual({ x: 0, y: 0 });
    expect(rendered.players.find((p) => p.id === 'p2')!.pos).toEqual({ x: 10, y: 10 });
  });

  it('snaps new entrants to their first observed position', () => {
    const interp = createSnapshotInterpolator({ lerpRate: 12 });
    interp.ingest(snapshot(0, [{ id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } }]));
    interp.ingest(snapshot(1, [
      { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } },
      { id: 'p2', characterId: 'c2', name: 'B', pos: { x: 7, y: 3 } },
    ]));
    const rendered = interp.interpolate(0.016);
    const p2 = rendered.players.find((p) => p.id === 'p2')!;
    expect(p2.pos).toEqual({ x: 7, y: 3 });
  });

  it('exposes mobs with their HP and alive flag in the frame', () => {
    const interp = createSnapshotInterpolator({ lerpRate: 12 });
    interp.ingest(snapshot(
      0,
      [],
      [{ id: 'skel-1', kind: 'skeleton', pos: { x: 4, y: 5 }, hp: 30, maxHp: 60, alive: true }]
    ));
    const rendered = interp.interpolate(0.016);
    expect(rendered.mobs).toHaveLength(1);
    expect(rendered.mobs[0]).toMatchObject({
      id: 'skel-1',
      kind: 'skeleton',
      hp: 30,
      maxHp: 60,
      alive: true,
    });
    expect(rendered.mobs[0]!.pos).toEqual({ x: 4, y: 5 });
  });

  it('updates mob hp + alive flag on subsequent ingests', () => {
    const interp = createSnapshotInterpolator({ lerpRate: 12 });
    interp.ingest(snapshot(0, [], [{
      id: 'skel-1', kind: 'skeleton', pos: { x: 4, y: 5 }, hp: 30, maxHp: 60, alive: true,
    }]));
    interp.ingest(snapshot(1, [], [{
      id: 'skel-1', kind: 'skeleton', pos: { x: 4, y: 5 }, hp: 0, maxHp: 60, alive: false,
    }]));
    const rendered = interp.interpolate(0.016);
    expect(rendered.mobs[0]!.alive).toBe(false);
    expect(rendered.mobs[0]!.hp).toBe(0);
  });
});

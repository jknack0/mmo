import { describe, it, expect } from 'vitest';
import type { ZoneSnapshot } from '@mmo/protocol';
import { createSnapshotInterpolator } from './snapshot-interpolator.js';

function snapshot(
  tick: number,
  players: { id: string; characterId: string; name: string; pos: { x: number; y: number } }[]
): ZoneSnapshot {
  return { tick, players };
}

describe('SnapshotInterpolator', () => {
  it('renders the first snapshot exactly with no smoothing', () => {
    const interp = createSnapshotInterpolator({ lerpRate: 12 });
    interp.ingest(snapshot(0, [{ id: 'p1', characterId: 'c1', name: 'A', pos: { x: 5, y: 5 } }]));
    const rendered = interp.interpolate(0.016);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]!.pos).toEqual({ x: 5, y: 5 });
  });

  it('lerps toward a moved target across ingests', () => {
    const interp = createSnapshotInterpolator({ lerpRate: 12 });
    interp.ingest(snapshot(0, [{ id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } }]));
    interp.interpolate(0.016);
    interp.ingest(snapshot(1, [{ id: 'p1', characterId: 'c1', name: 'A', pos: { x: 10, y: 10 } }]));
    const rendered = interp.interpolate(0.1);
    // exponential lerp: 1 - exp(-12 * 0.1) ≈ 0.6988
    expect(rendered[0]!.pos.x).toBeGreaterThan(0);
    expect(rendered[0]!.pos.x).toBeLessThan(10);
  });

  it('converges to the latest target with enough integrated dt', () => {
    const interp = createSnapshotInterpolator({ lerpRate: 12 });
    interp.ingest(snapshot(0, [{ id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } }]));
    interp.ingest(snapshot(1, [{ id: 'p1', characterId: 'c1', name: 'A', pos: { x: 5, y: 5 } }]));
    interp.interpolate(2);
    const rendered = interp.interpolate(0.016);
    expect(rendered[0]!.pos.x).toBeCloseTo(5, 2);
    expect(rendered[0]!.pos.y).toBeCloseTo(5, 2);
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
    expect(rendered.map((p) => p.id)).toEqual(['p1']);
  });

  it('tracks multiple players independently', () => {
    const interp = createSnapshotInterpolator({ lerpRate: 12 });
    interp.ingest(snapshot(0, [
      { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } },
      { id: 'p2', characterId: 'c2', name: 'B', pos: { x: 10, y: 10 } },
    ]));
    const rendered = interp.interpolate(0.016);
    expect(rendered.find((p) => p.id === 'p1')!.pos).toEqual({ x: 0, y: 0 });
    expect(rendered.find((p) => p.id === 'p2')!.pos).toEqual({ x: 10, y: 10 });
  });

  it('snaps new entrants to their first observed position (no smoothing from zero)', () => {
    const interp = createSnapshotInterpolator({ lerpRate: 12 });
    interp.ingest(snapshot(0, [{ id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } }]));
    interp.ingest(snapshot(1, [
      { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } },
      { id: 'p2', characterId: 'c2', name: 'B', pos: { x: 7, y: 3 } },
    ]));
    const rendered = interp.interpolate(0.016);
    const p2 = rendered.find((p) => p.id === 'p2')!;
    expect(p2.pos).toEqual({ x: 7, y: 3 });
  });
});

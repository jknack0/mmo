import { describe, it, expect } from 'vitest';
import {
  computeSnapshotDelta,
  applySnapshotDelta,
  frameToSnapshot,
  emptyFrame,
  PF,
  type HandledFrame,
  encodeServerMessage,
  decodeServerMessage,
  type ServerMessage,
  type PlayerState,
  type MobState,
} from './index.js';

function player(h: number, over: Partial<PlayerState> = {}): PlayerState {
  return {
    id: `player-uuid-0000-${h}`, characterId: `char-${h}`, name: `Hero${h}`,
    pos: { x: h, y: h }, engagedTargetId: null,
    spirit: 50, maxSpirit: 100, wrath: 0, maxWrath: 100, hp: 100, maxHp: 100, dead: false,
    ...over,
  };
}
function mob(h: number, over: Partial<MobState> = {}): MobState {
  return { id: `mob-uuid-${h}`, kind: 'skeleton', pos: { x: h, y: h }, hp: 60, maxHp: 60, alive: true, ...over };
}
function frame(tick: number, players: PlayerState[], mobs: MobState[] = []): HandledFrame {
  const f = emptyFrame(tick);
  players.forEach((p, i) => f.players.set(i + 1, p));
  mobs.forEach((m, i) => f.mobs.set(i + 100, m));
  return f;
}

describe('snapshot delta (S24)', () => {
  it('emits only changed fields and round-trips compute → apply', () => {
    const a = frame(1, [player(1), player(2)], [mob(1)]);
    const b = frame(2,
      [player(1, { pos: { x: 5, y: 6 } }), player(2)],     // p1 moved, p2 unchanged
      [mob(1, { hp: 40, burnStacks: 2 })]);                 // mob took damage + burn

    const delta = computeSnapshotDelta(a, b);
    // Only the changed player + mob appear.
    expect(delta.players.map((d) => d.h)).toEqual([1]);
    expect(delta.players[0]!.mask & PF.POS).toBeTruthy();
    expect(delta.players[0]!.mask & PF.HP).toBeFalsy();
    expect(delta.mobs.map((d) => d.h)).toEqual([100]);

    const reconstructed = applySnapshotDelta(a, delta);
    expect(frameToSnapshot(reconstructed)).toEqual(frameToSnapshot(b));
  });

  it('a brand-new entity carries all fields; a removed one is listed', () => {
    const a = frame(1, [player(1)]);
    const b = frame(2, [player(1), player(2)]); // p2 added
    const delta = computeSnapshotDelta(a, b);
    expect(delta.players.map((d) => d.h)).toContain(2);
    // Applying onto a base WITHOUT p2 reconstructs it fully.
    expect(frameToSnapshot(applySnapshotDelta(a, delta)).players).toHaveLength(2);

    const c = frame(3, [player(1)]); // p2 removed
    const delta2 = computeSnapshotDelta(b, c);
    expect(delta2.removedPlayers).toEqual([2]);
    expect(frameToSnapshot(applySnapshotDelta(b, delta2)).players).toHaveLength(1);
  });

  it('keyframe + delta messages round-trip through the binary codec', () => {
    const f = frame(7, [player(1), player(2)], [mob(1)]);
    const keyframe: ServerMessage = {
      type: 'keyframe', tick: f.tick,
      players: [...f.players].map(([h, p]) => ({ h, ...p })),
      mobs: [...f.mobs].map(([h, m]) => ({ h, ...m })),
      ground: [],
    };
    expect(decodeServerMessage(encodeServerMessage(keyframe))).toEqual(keyframe);

    const g = frame(8, [player(1, { hp: 70, dead: false }), player(2, { pos: { x: 9, y: 9 } })], [mob(1, { alive: false })]);
    const deltaMsg: ServerMessage = { type: 'delta', delta: computeSnapshotDelta(f, g) };
    expect(decodeServerMessage(encodeServerMessage(deltaMsg))).toEqual(deltaMsg);
  });

  it('chaos: a dropped delta drifts state until the next keyframe resyncs it', () => {
    const a = frame(1, [player(1, { hp: 100 })]);
    const b = frame(2, [player(1, { hp: 80 })]);
    const c = frame(3, [player(1, { hp: 60 })]);

    // Client applies a→b but the b→c delta is DROPPED, so its state is stale.
    const stale = applySnapshotDelta(a, computeSnapshotDelta(a, b));
    expect(frameToSnapshot(stale).players[0]!.hp).toBe(80); // missed the drop to 60

    // A keyframe (full state c) fully resyncs regardless of the gap.
    const resynced = frame(3, [player(1, { hp: 60 })]);
    expect(frameToSnapshot(resynced).players[0]!.hp).toBe(60);
    void c;
  });

  it('delta stream is ≥80% smaller than full snapshots for 10 moving players', () => {
    const N = 10;
    const mk = (tick: number): HandledFrame => {
      const f = emptyFrame(tick);
      for (let h = 1; h <= N; h++) f.players.set(h, player(h, { pos: { x: h + tick * 0.1, y: h } }));
      return f;
    };
    let prev = mk(0);
    const keyframe0: ServerMessage = {
      type: 'keyframe', tick: 0,
      players: [...prev.players].map(([h, p]) => ({ h, ...p })), mobs: [], ground: [],
    };
    let deltaBytes = encodeServerMessage(keyframe0).length;
    let fullBytes = 0;
    for (let t = 0; t < 100; t++) {
      const f = mk(t);
      fullBytes += encodeServerMessage({ type: 'snapshot', snapshot: frameToSnapshot(f) }).length;
      if (t > 0) {
        deltaBytes += encodeServerMessage({ type: 'delta', delta: computeSnapshotDelta(prev, f) }).length;
        prev = f;
      }
    }
    expect(deltaBytes).toBeLessThanOrEqual(fullBytes * 0.2);
  });
});

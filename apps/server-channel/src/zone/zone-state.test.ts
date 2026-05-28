import { describe, it, expect } from 'vitest';
import {
  createZoneState,
  spawnPlayer,
  despawnPlayer,
  setPlayerTarget,
  stepMovement,
  snapshotZone,
} from './zone-state.js';

// 5×5 grid where x=2 is a blocked column. Used by collision tests.
const TEST_MAP = [
  [0, 0, 1, 0, 0],
  [0, 0, 1, 0, 0],
  [0, 0, 1, 0, 0],
  [0, 0, 1, 0, 0],
  [0, 0, 1, 0, 0],
];

function tinyZone() {
  return createZoneState({ size: { x: 5, y: 5 }, tileMap: TEST_MAP });
}

describe('ZoneState — construction', () => {
  it('starts at tick 0 with no players', () => {
    const zone = tinyZone();
    expect(zone.tick).toBe(0);
    expect(zone.players.size).toBe(0);
  });

  it('exposes the configured size and tile map', () => {
    const zone = tinyZone();
    expect(zone.size).toEqual({ x: 5, y: 5 });
    expect(zone.tileMap).toBe(TEST_MAP);
  });
});

describe('spawnPlayer', () => {
  it('adds the player to the players map at the given spawn position', () => {
    const zone = tinyZone();
    const player = spawnPlayer(zone, {
      id: 'p1',
      characterId: 'c1',
      name: 'Alice',
      pos: { x: 1, y: 1 },
    });
    expect(player.pos).toEqual({ x: 1, y: 1 });
    expect(zone.players.get('p1')).toBe(player);
  });

  it('defaults the spawn position to the centre of the map', () => {
    const zone = tinyZone();
    const player = spawnPlayer(zone, {
      id: 'p1',
      characterId: 'c1',
      name: 'Alice',
    });
    expect(player.pos).toEqual({ x: 2, y: 2 });
  });
});

describe('despawnPlayer', () => {
  it('removes the player from the players map', () => {
    const zone = tinyZone();
    spawnPlayer(zone, { id: 'p1', characterId: 'c1', name: 'A' });
    despawnPlayer(zone, 'p1');
    expect(zone.players.has('p1')).toBe(false);
  });

  it('is a no-op for unknown player ids', () => {
    const zone = tinyZone();
    expect(() => despawnPlayer(zone, 'ghost')).not.toThrow();
  });
});

describe('setPlayerTarget', () => {
  it('stores the target on the player', () => {
    const zone = tinyZone();
    spawnPlayer(zone, { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } });
    setPlayerTarget(zone, 'p1', { x: 3, y: 4 });
    expect(zone.players.get('p1')!.target).toEqual({ x: 3, y: 4 });
  });

  it('clamps targets outside the map to its bounds', () => {
    const zone = tinyZone();
    spawnPlayer(zone, { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } });
    setPlayerTarget(zone, 'p1', { x: 99, y: -5 });
    const t = zone.players.get('p1')!.target!;
    // size is 5, so max walkable index is 4.
    expect(t.x).toBeLessThanOrEqual(4);
    expect(t.y).toBeGreaterThanOrEqual(0);
  });

  it('rejects targets on a blocked tile (target stays null)', () => {
    const zone = tinyZone();
    spawnPlayer(zone, { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 0, y: 0 } });
    const ok = setPlayerTarget(zone, 'p1', { x: 2, y: 2 }); // blocked column
    expect(ok).toBe(false);
    expect(zone.players.get('p1')!.target).toBeNull();
  });
});

describe('stepMovement', () => {
  it('does not move a player without a target', () => {
    const zone = tinyZone();
    const player = spawnPlayer(zone, {
      id: 'p1',
      characterId: 'c1',
      name: 'A',
      pos: { x: 0, y: 0 },
    });
    stepMovement(zone, 1);
    expect(player.pos).toEqual({ x: 0, y: 0 });
  });

  it('lerps the player toward its target by speed × dt', () => {
    const zone = tinyZone();
    const player = spawnPlayer(zone, {
      id: 'p1',
      characterId: 'c1',
      name: 'A',
      pos: { x: 0, y: 0 },
      speed: 4,
    });
    setPlayerTarget(zone, 'p1', { x: 4, y: 0 });
    stepMovement(zone, 0.5); // 4 * 0.5 = 2 tiles travelled
    expect(player.pos.x).toBeCloseTo(2, 5);
    expect(player.pos.y).toBeCloseTo(0, 5);
  });

  it('snaps to the target and clears it on arrival', () => {
    const zone = tinyZone();
    const player = spawnPlayer(zone, {
      id: 'p1',
      characterId: 'c1',
      name: 'A',
      pos: { x: 0, y: 0 },
      speed: 10,
    });
    setPlayerTarget(zone, 'p1', { x: 1, y: 1 });
    stepMovement(zone, 1); // 10 tiles allowance >> sqrt(2)
    expect(player.pos).toEqual({ x: 1, y: 1 });
    expect(player.target).toBeNull();
  });

  it('increments the tick counter', () => {
    const zone = tinyZone();
    stepMovement(zone, 0.05);
    stepMovement(zone, 0.05);
    expect(zone.tick).toBe(2);
  });

  it('moves multiple players in one step', () => {
    const zone = tinyZone();
    const a = spawnPlayer(zone, {
      id: 'a', characterId: 'ca', name: 'A',
      pos: { x: 0, y: 0 }, speed: 2,
    });
    const b = spawnPlayer(zone, {
      id: 'b', characterId: 'cb', name: 'B',
      pos: { x: 4, y: 4 }, speed: 2,
    });
    setPlayerTarget(zone, 'a', { x: 1, y: 0 });
    setPlayerTarget(zone, 'b', { x: 3, y: 4 });
    stepMovement(zone, 0.5);
    expect(a.pos.x).toBeCloseTo(1, 5);
    expect(b.pos.x).toBeCloseTo(3, 5);
  });
});

describe('snapshotZone', () => {
  it('produces a serialisable ZoneSnapshot of the current state', () => {
    const zone = tinyZone();
    spawnPlayer(zone, {
      id: 'p1', characterId: 'c1', name: 'Alice',
      pos: { x: 1, y: 1 },
    });
    stepMovement(zone, 0.05);
    const snap = snapshotZone(zone);
    expect(snap.tick).toBe(1);
    expect(snap.players).toHaveLength(1);
    expect(snap.players[0]?.name).toBe('Alice');
  });
});

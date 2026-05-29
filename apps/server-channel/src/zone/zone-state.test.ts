import { describe, it, expect } from 'vitest';
import {
  createZoneState,
  spawnPlayer,
  despawnPlayer,
  setPlayerTarget,
  stepMovement,
  snapshotZone,
  spawnMob,
  damageMob,
  stepMobs,
  addGroundItem,
  removeGroundItem,
  nearestGroundItem,
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
    expect(snap.mobs).toEqual([]);
  });

  it('includes alive and dead mobs in the snapshot', () => {
    const zone = tinyZone();
    spawnMob(zone, { id: 'skel-1', kind: 'skeleton', pos: { x: 3, y: 3 }, maxHp: 100 });
    spawnMob(zone, { id: 'skel-2', kind: 'skeleton', pos: { x: 0, y: 4 }, maxHp: 50 });
    damageMob(zone, 'skel-2', 100, 1000);
    const snap = snapshotZone(zone);
    expect(snap.mobs).toHaveLength(2);
    const skel2 = snap.mobs.find((m) => m.id === 'skel-2');
    expect(skel2?.alive).toBe(false);
    expect(skel2?.hp).toBe(0);
  });
});

describe('Ground items (S13)', () => {
  it('adds and snapshots a ground item', () => {
    const zone = tinyZone();
    addGroundItem(zone, { id: 'item-1', baseId: 'copper-ring', pos: { x: 2, y: 3 } });
    const snap = snapshotZone(zone);
    expect(snap.groundItems).toEqual([
      { id: 'item-1', baseId: 'copper-ring', pos: { x: 2, y: 3 } },
    ]);
  });

  it('removes a ground item and returns it', () => {
    const zone = tinyZone();
    addGroundItem(zone, { id: 'item-1', baseId: 'rusty-sword', pos: { x: 1, y: 1 } });
    const removed = removeGroundItem(zone, 'item-1');
    expect(removed?.baseId).toBe('rusty-sword');
    expect(zone.groundItems.size).toBe(0);
    expect(removeGroundItem(zone, 'item-1')).toBeUndefined();
  });

  it('finds the nearest ground item within radius only', () => {
    const zone = tinyZone();
    addGroundItem(zone, { id: 'near', baseId: 'copper-ring', pos: { x: 1, y: 1 } });
    addGroundItem(zone, { id: 'far', baseId: 'rusty-sword', pos: { x: 4, y: 4 } });
    const found = nearestGroundItem(zone, { x: 1, y: 1.4 }, 1.5);
    expect(found?.id).toBe('near');
    // nothing within radius
    expect(nearestGroundItem(zone, { x: 0, y: 0 }, 0.5)).toBeUndefined();
  });
});

describe('Mobs — spawn, damage, respawn', () => {
  it('spawnMob adds a mob at the requested position with full HP', () => {
    const zone = tinyZone();
    const m = spawnMob(zone, { id: 'skel-1', kind: 'skeleton', pos: { x: 3, y: 1 }, maxHp: 80 });
    expect(m.pos).toEqual({ x: 3, y: 1 });
    expect(m.hp).toBe(80);
    expect(m.maxHp).toBe(80);
    expect(m.alive).toBe(true);
    expect(zone.mobs.size).toBe(1);
  });

  it('damageMob reduces HP and reports non-fatal hits', () => {
    const zone = tinyZone();
    spawnMob(zone, { id: 'm', kind: 'skeleton', pos: { x: 3, y: 1 }, maxHp: 100 });
    const r = damageMob(zone, 'm', 30, 1000);
    expect(r).toEqual({ fatal: false, applied: 30 });
    expect(zone.mobs.get('m')!.hp).toBe(70);
  });

  it('damageMob kills the mob when HP reaches 0', () => {
    const zone = tinyZone();
    spawnMob(zone, { id: 'm', kind: 'skeleton', pos: { x: 3, y: 1 }, maxHp: 100, respawnMs: 5000 });
    const r = damageMob(zone, 'm', 999, 1000);
    expect(r).toEqual({ fatal: true, applied: 100 });
    const m = zone.mobs.get('m')!;
    expect(m.alive).toBe(false);
    expect(m.hp).toBe(0);
    expect(m.respawnAt).toBe(6000);
  });

  it('damageMob is a no-op on dead mobs', () => {
    const zone = tinyZone();
    spawnMob(zone, { id: 'm', kind: 'skeleton', pos: { x: 3, y: 1 }, maxHp: 100 });
    damageMob(zone, 'm', 999, 1000);
    const r = damageMob(zone, 'm', 50, 1500);
    expect(r).toEqual({ fatal: false, applied: 0 });
  });

  it('stepMobs respawns dead mobs whose timer has elapsed', () => {
    const zone = tinyZone();
    spawnMob(zone, { id: 'm', kind: 'skeleton', pos: { x: 3, y: 1 }, maxHp: 100, respawnMs: 5000 });
    damageMob(zone, 'm', 999, 1000);
    stepMobs(zone, 5999);
    expect(zone.mobs.get('m')!.alive).toBe(false);
    stepMobs(zone, 6000);
    const m = zone.mobs.get('m')!;
    expect(m.alive).toBe(true);
    expect(m.hp).toBe(100);
    expect(m.respawnAt).toBeNull();
  });

  it('stepMobs is a no-op for alive mobs', () => {
    const zone = tinyZone();
    spawnMob(zone, { id: 'm', kind: 'skeleton', pos: { x: 3, y: 1 }, maxHp: 100 });
    stepMobs(zone, 99999);
    expect(zone.mobs.get('m')!.alive).toBe(true);
  });

  it('damaging an unknown mob is a no-op', () => {
    const zone = tinyZone();
    expect(damageMob(zone, 'ghost', 10, 1000)).toEqual({ fatal: false, applied: 0 });
  });
});

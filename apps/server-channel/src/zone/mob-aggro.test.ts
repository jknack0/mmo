import { describe, it, expect } from 'vitest';
import {
  createZoneState,
  spawnPlayer,
  spawnMob,
  snapshotZone,
  stepMobAggro,
  MOB_CONTACT_DAMAGE,
  type ZoneState,
} from './zone-state.js';

function zone(): ZoneState {
  return createZoneState({
    size: { x: 40, y: 40 },
    tileMap: Array.from({ length: 40 }, () => new Array(40).fill(0)),
  });
}

describe('player HP (S16)', () => {
  it('spawns at full HP, maxHp = BASE_HP with no gear', () => {
    const z = zone();
    const p = spawnPlayer(z, { id: 'p1', characterId: 'c1', name: 'A' });
    expect(p.maxHp).toBe(100);
    expect(p.hp).toBe(100);
  });

  it('scales maxHp with equipped VIT', () => {
    const z = zone();
    const p = spawnPlayer(z, {
      id: 'p1',
      characterId: 'c1',
      name: 'A',
      itemStats: { str: 0, dex: 0, int: 0, vit: 5, weaponDamage: 0, armor: 0, firePct: 0 },
    });
    expect(p.maxHp).toBe(150); // 100 + 5*10
    expect(p.hp).toBe(150);
  });

  it('snapshot carries hp + maxHp', () => {
    const z = zone();
    const p = spawnPlayer(z, { id: 'p1', characterId: 'c1', name: 'A' });
    p.hp = 73;
    const snap = snapshotZone(z);
    expect(snap.players[0]!.hp).toBe(73);
    expect(snap.players[0]!.maxHp).toBe(100);
  });
});

describe('stepMobAggro (S16)', () => {
  it('a mob outside aggro range does not move', () => {
    const z = zone();
    spawnPlayer(z, { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 10, y: 10 } });
    const m = spawnMob(z, { id: 'm1', kind: 'skeleton', pos: { x: 30, y: 30 }, maxHp: 50 });
    stepMobAggro(z, 0.1, 1000);
    expect(m.pos).toEqual({ x: 30, y: 30 });
  });

  it('a mob inside aggro range moves toward the player', () => {
    const z = zone();
    spawnPlayer(z, { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 10, y: 10 } });
    const m = spawnMob(z, { id: 'm1', kind: 'skeleton', pos: { x: 13, y: 10 }, maxHp: 50 });
    stepMobAggro(z, 0.1, 1000);
    expect(m.pos.x).toBeLessThan(13);
    expect(m.pos.x).toBeGreaterThan(10);
  });

  it('a mob in contact range damages the player on its attack cooldown', () => {
    const z = zone();
    const p = spawnPlayer(z, { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 10, y: 10 } });
    spawnMob(z, { id: 'm1', kind: 'skeleton', pos: { x: 10.5, y: 10 }, maxHp: 50 });

    const hits1 = stepMobAggro(z, 0.1, 1000);
    expect(hits1).toHaveLength(1);
    expect(hits1[0]).toMatchObject({ playerId: 'p1', mobId: 'm1', amount: MOB_CONTACT_DAMAGE, fatal: false });
    expect(p.hp).toBe(100 - MOB_CONTACT_DAMAGE);

    // Same instant — still on cooldown, no extra damage.
    const hits2 = stepMobAggro(z, 0.1, 1000);
    expect(hits2).toHaveLength(0);
    expect(p.hp).toBe(100 - MOB_CONTACT_DAMAGE);

    // Cooldown elapsed — hits again.
    const hits3 = stepMobAggro(z, 0.1, 3000);
    expect(hits3).toHaveLength(1);
    expect(p.hp).toBe(100 - 2 * MOB_CONTACT_DAMAGE);
  });

  it('lethal contact respawns the player at full HP and reports fatal', () => {
    const z = zone();
    const p = spawnPlayer(z, { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 10, y: 10 } });
    p.hp = 4;
    spawnMob(z, { id: 'm1', kind: 'skeleton', pos: { x: 10.2, y: 10 }, maxHp: 50 });
    const hits = stepMobAggro(z, 0.1, 1000);
    expect(hits[0]!.fatal).toBe(true);
    expect(p.hp).toBe(p.maxHp); // respawned full
  });

  it('a mob that chases in from range eventually bites (no boundary asymptote)', () => {
    const z = zone();
    const p = spawnPlayer(z, { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 10, y: 10 } });
    spawnMob(z, { id: 'm1', kind: 'skeleton', pos: { x: 14, y: 11 }, maxHp: 50 });
    // Step ~3s at 20Hz: the mob closes the gap and must land at least one bite.
    let now = 1000;
    for (let i = 0; i < 60; i++) {
      stepMobAggro(z, 0.05, now);
      now += 50;
    }
    expect(p.hp).toBeLessThan(p.maxHp);
  });

  it('dodge i-frames block contact damage', () => {
    const z = zone();
    const p = spawnPlayer(z, { id: 'p1', characterId: 'c1', name: 'A', pos: { x: 10, y: 10 } });
    p.dodgeInvulUntil = 5000;
    spawnMob(z, { id: 'm1', kind: 'skeleton', pos: { x: 10.2, y: 10 }, maxHp: 50 });
    const hits = stepMobAggro(z, 0.1, 1000);
    expect(hits).toHaveLength(0);
    expect(p.hp).toBe(100);
  });
});

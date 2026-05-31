import { describe, it, expect } from 'vitest';
import { createZoneState, spawnPlayer, spawnMob } from '../zone/zone-state.js';
import { attemptAttack, SKILL_DEFS } from './combat-system.js';

const OPEN = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));

function zoneWith(passives: Record<string, number>) {
  const zone = createZoneState({ size: { x: 10, y: 10 }, tileMap: OPEN });
  spawnPlayer(zone, { id: 'p1', characterId: 'c1', name: 'Blade', pos: { x: 5, y: 5 }, passives, equippedPyroSkillCount: 0 });
  spawnMob(zone, { id: 'm1', kind: 'skeleton', pos: { x: 5, y: 6 }, maxHp: 999 });
  return zone;
}

describe('Blademaster skills (S11)', () => {
  it('the Blademaster skills exist and are physical (not Fire)', () => {
    for (const id of ['slash', 'blade-dash', 'cleave', 'decisive-strike']) {
      expect(SKILL_DEFS[id]).toBeDefined();
      expect(SKILL_DEFS[id]!.fire).toBeFalsy();
    }
  });

  it('a weapon skill is NOT scaled by Fire passives', () => {
    const fireBuild = zoneWith({ 'embered-soul': 1, 'inner-furnace': 1, 'sharpened-flame': 1 });
    const r = attemptAttack(fireBuild, 'p1', 'm1', 'slash', 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.damage).toBe(SKILL_DEFS.slash!.damage); // pure base — fire% didn't touch it
  });

  it('weaponDamageMult (Honed Edge) raises Blademaster damage', () => {
    const base = attemptAttack(zoneWith({}), 'p1', 'm1', 'decisive-strike', 1000);
    const honed = attemptAttack(
      zoneWith({ 'embered-soul': 1, 'inner-furnace': 1, 'honed-edge': 1 }),
      'p1',
      'm1',
      'decisive-strike',
      1000
    );
    expect(base.ok && honed.ok).toBe(true);
    if (!base.ok || !honed.ok) return;
    expect(honed.damage).toBeGreaterThan(base.damage); // +10% weapon damage
  });
});

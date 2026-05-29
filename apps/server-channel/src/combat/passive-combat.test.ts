// S10 (#12) — derived passive stats observably change combat.
import { describe, it, expect } from 'vitest';
import { createZoneState, spawnPlayer, spawnMob } from '../zone/zone-state.js';
import { attemptAttack, SKILL_DEFS } from './combat-system.js';
import type { PassiveAllocation } from '@mmo/domain';

const OPEN_MAP = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));
const alloc = (...ids: string[]): PassiveAllocation =>
  Object.fromEntries(ids.map((id) => [id, 1]));

function zoneWith(passives?: PassiveAllocation, equippedPyroSkillCount?: number) {
  const zone = createZoneState({ size: { x: 10, y: 10 }, tileMap: OPEN_MAP });
  spawnPlayer(zone, {
    id: 'p1',
    characterId: 'c1',
    name: 'Alice',
    pos: { x: 5, y: 5 },
    passives,
    equippedPyroSkillCount,
  });
  spawnMob(zone, {
    id: 'm',
    kind: 'skeleton',
    pos: { x: 5, y: 6 },
    maxHp: 1000,
    respawnMs: 5000,
  });
  return zone;
}

describe('fire damage multiplier', () => {
  it('boosts a fire skill but not the weapon basic-attack', () => {
    // embered (+5) + sharpened (+8) = fireDamageMult 1.13
    const z = zoneWith(alloc('embered-soul', 'inner-furnace', 'sharpened-flame'));
    const r = attemptAttack(z, 'p1', 'm', 'spark', 1000);
    expect(r.ok && r.damage).toBe(Math.round(SKILL_DEFS['spark']!.damage * 1.13)); // 11

    const z2 = zoneWith(alloc('embered-soul', 'inner-furnace', 'sharpened-flame'));
    const basic = attemptAttack(z2, 'p1', 'm', 'basic-attack', 1000);
    expect(basic.ok && basic.damage).toBe(SKILL_DEFS['basic-attack']!.damage); // 12, unscaled
  });
});

describe('explosion damage multiplier', () => {
  it('stacks on top of fire damage for explosion-type skills', () => {
    const z = zoneWith(
      alloc('embered-soul', 'inner-furnace', 'sharpened-flame', 'critical-heat', 'detonation')
    );
    const r = attemptAttack(z, 'p1', 'm', 'fireball', 1000);
    // 30 * 1.13 (fire) * 1.10 (explosion) = 37.29 → 37
    expect(r.ok && r.damage).toBe(Math.round(30 * 1.13 * 1.1));
  });
});

describe('heavy-nuke cooldown reduction (Overcast)', () => {
  it('shortens Meteor cooldown by 10%', () => {
    const z = zoneWith(
      alloc('embered-soul', 'inner-furnace', 'sharpened-flame', 'critical-heat', 'detonation', 'overcast')
    );
    attemptAttack(z, 'p1', 'm', 'meteor', 1000);
    const expires = z.players.get('p1')!.cooldowns.get('meteor');
    expect(expires).toBe(1000 + Math.round(SKILL_DEFS['meteor']!.cooldownMs * 0.9)); // 1000 + 27000
  });
});

describe('Annihilator loadout scaling', () => {
  const directToAnnihilator = alloc(
    'embered-soul', 'inner-furnace', 'sharpened-flame', 'critical-heat', 'detonation', 'overcast', 'annihilator'
  );
  it('does more damage at 6 equipped Pyro skills than at 3', () => {
    const z6 = zoneWith(directToAnnihilator, 6); // fireMult 1.25
    const z3 = zoneWith(directToAnnihilator, 3); // fireMult 1.19
    const d6 = attemptAttack(z6, 'p1', 'm', 'spark', 1000);
    const d3 = attemptAttack(z3, 'p1', 'm', 'spark', 1000);
    expect(d6.ok && d6.damage).toBe(Math.round(10 * 1.25)); // 13
    expect(d3.ok && d3.damage).toBe(Math.round(10 * 1.19)); // 12
  });
});

describe('Flashburn keystone', () => {
  const directFull = alloc(
    'embered-soul', 'inner-furnace', 'sharpened-flame', 'critical-heat',
    'detonation', 'overcast', 'annihilator', 'flashburn'
  );
  it('adds 40% Pyro damage and applies NO Burn', () => {
    const z = zoneWith(directFull, 6); // fireMult 1.65
    const r = attemptAttack(z, 'p1', 'm', 'cinder-spray', 1000);
    // cinder-spray base 8 * 1.65 = 13.2 → 13
    expect(r.ok && r.damage).toBe(Math.round(8 * 1.65));
    // cinder-spray normally applies 1 Burn — Flashburn suppresses it
    expect(z.mobs.get('m')!.burnStacks).toBe(0);
  });

  it('contrast: without Flashburn, cinder-spray applies a Burn stack', () => {
    const z = zoneWith({});
    attemptAttack(z, 'p1', 'm', 'cinder-spray', 1000);
    expect(z.mobs.get('m')!.burnStacks).toBe(1);
  });
});

describe('Burn stack cap keystones', () => {
  it('Inferno removes the cap (stacks past default 5)', () => {
    const burnFull = alloc(
      'embered-soul', 'inner-furnace', 'lingering-heat', 'searing-touch',
      'smoldering-application', 'combustion-engineer', 'wildfire', 'inferno'
    );
    const z = zoneWith(burnFull);
    z.mobs.get('m')!.burnStacks = 5; // already at default cap
    attemptAttack(z, 'p1', 'm', 'cinder-spray', 1000); // +1 stack
    expect(z.mobs.get('m')!.burnStacks).toBe(6);
  });

  it('Searing Touch raises the cap to 6', () => {
    const z = zoneWith(alloc('embered-soul', 'inner-furnace', 'lingering-heat', 'searing-touch'));
    z.mobs.get('m')!.burnStacks = 5;
    attemptAttack(z, 'p1', 'm', 'cinder-spray', 1000);
    expect(z.mobs.get('m')!.burnStacks).toBe(6);
  });

  it('default cap (no passives) holds at 5', () => {
    const z = zoneWith({});
    z.mobs.get('m')!.burnStacks = 5;
    attemptAttack(z, 'p1', 'm', 'cinder-spray', 1000);
    expect(z.mobs.get('m')!.burnStacks).toBe(5);
  });
});

describe('Lingering Heat burn duration', () => {
  it('extends Burn expiry by 20%', () => {
    const z = zoneWith(alloc('embered-soul', 'inner-furnace', 'lingering-heat'));
    attemptAttack(z, 'p1', 'm', 'cinder-spray', 1000);
    // base 6000ms * 1.20 = 7200
    expect(z.mobs.get('m')!.burnExpiresAt).toBe(1000 + Math.round(6000 * 1.2));
  });
});

describe('Inner Furnace max Spirit', () => {
  it('raises max Spirit by 5% at spawn', () => {
    const z = zoneWith(alloc('embered-soul', 'inner-furnace'));
    const p = z.players.get('p1')!;
    expect(p.resources.maxSpirit).toBe(Math.round(100 * 1.05)); // 105
    expect(p.resources.spirit).toBe(105);
  });
});

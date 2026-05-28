import { describe, it, expect } from 'vitest';
import {
  createZoneState,
  spawnPlayer,
  spawnMob,
} from '../zone/zone-state.js';
import {
  attemptAttack,
  SKILL_DEFS,
} from './combat-system.js';

const OPEN_MAP = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));

function setup() {
  const zone = createZoneState({ size: { x: 10, y: 10 }, tileMap: OPEN_MAP });
  spawnPlayer(zone, {
    id: 'p1',
    characterId: 'c1',
    name: 'Alice',
    pos: { x: 5, y: 5 },
  });
  spawnMob(zone, {
    id: 'skel-1',
    kind: 'skeleton',
    pos: { x: 5, y: 6 },
    maxHp: 50,
    respawnMs: 5000,
  });
  return zone;
}

describe('CombatSystem.attemptAttack', () => {
  it('lands a basic attack on a mob within range', () => {
    const zone = setup();
    const result = attemptAttack(zone, 'p1', 'skel-1', 'basic-attack', 1000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.damage).toBe(SKILL_DEFS['basic-attack']!.damage);
    expect(zone.mobs.get('skel-1')!.hp).toBe(
      50 - SKILL_DEFS['basic-attack']!.damage
    );
  });

  it('rejects out-of-range attacks', () => {
    const zone = setup();
    zone.players.get('p1')!.pos = { x: 0, y: 0 };
    const result = attemptAttack(zone, 'p1', 'skel-1', 'basic-attack', 1000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('out-of-range');
  });

  it('rejects attacks against dead mobs', () => {
    const zone = setup();
    zone.mobs.get('skel-1')!.alive = false;
    zone.mobs.get('skel-1')!.hp = 0;
    const result = attemptAttack(zone, 'p1', 'skel-1', 'basic-attack', 1000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-dead');
  });

  it('rejects attacks while the skill is on cooldown', () => {
    const zone = setup();
    attemptAttack(zone, 'p1', 'skel-1', 'basic-attack', 1000);
    const result = attemptAttack(zone, 'p1', 'skel-1', 'basic-attack', 1100);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('on-cooldown');
  });

  it('allows another attack after the cooldown expires', () => {
    const zone = setup();
    const cd = SKILL_DEFS['basic-attack']!.cooldownMs;
    attemptAttack(zone, 'p1', 'skel-1', 'basic-attack', 1000);
    const result = attemptAttack(zone, 'p1', 'skel-1', 'basic-attack', 1000 + cd);
    expect(result.ok).toBe(true);
  });

  it('reports fatal=true when the hit kills the mob', () => {
    const zone = setup();
    zone.mobs.get('skel-1')!.hp = 1;
    const result = attemptAttack(zone, 'p1', 'skel-1', 'basic-attack', 1000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fatal).toBe(true);
    expect(zone.mobs.get('skel-1')!.alive).toBe(false);
  });

  it('rejects unknown skill ids', () => {
    const zone = setup();
    const result = attemptAttack(zone, 'p1', 'skel-1', 'super-fire-spell', 1000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-skill');
  });

  it('rejects unknown attacker', () => {
    const zone = setup();
    const result = attemptAttack(zone, 'ghost', 'skel-1', 'basic-attack', 1000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('attacker-missing');
  });

  it('rejects unknown target', () => {
    const zone = setup();
    const result = attemptAttack(zone, 'p1', 'no-such-mob', 'basic-attack', 1000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-missing');
  });

  it('different skills have independent cooldowns', () => {
    const zone = setup();
    attemptAttack(zone, 'p1', 'skel-1', 'basic-attack', 1000);
    // Define a phantom second skill for this test only.
    SKILL_DEFS['phantom-strike'] = {
      id: 'phantom-strike',
      cooldownMs: 1000,
      rangeTiles: 3,
      damage: 5,
    };
    const result = attemptAttack(zone, 'p1', 'skel-1', 'phantom-strike', 1100);
    delete SKILL_DEFS['phantom-strike'];
    expect(result.ok).toBe(true);
  });
});

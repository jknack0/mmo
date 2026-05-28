import { describe, it, expect, beforeEach } from 'vitest';
import {
  createZoneState,
  spawnMob,
  applyBurnStacks,
  stepBurns,
  detonateBurns,
  BURN_CAP,
  BURN_DURATION_MS,
  BURN_TICK_INTERVAL_MS,
  BURN_DAMAGE_PER_STACK,
  type ZoneState,
} from './zone-state.js';

const OPEN_MAP = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));

function setup(): ZoneState {
  const zone = createZoneState({ size: { x: 10, y: 10 }, tileMap: OPEN_MAP });
  spawnMob(zone, { id: 'skel', kind: 'skeleton', pos: { x: 5, y: 5 }, maxHp: 100 });
  return zone;
}

describe('Burn DoT — applyBurnStacks', () => {
  let zone: ZoneState;
  beforeEach(() => { zone = setup(); });

  it('adds stacks to a fresh mob', () => {
    applyBurnStacks(zone, 'skel', 2, 'p1', 1000);
    const mob = zone.mobs.get('skel')!;
    expect(mob.burnStacks).toBe(2);
    expect(mob.burnLastAttackerId).toBe('p1');
  });

  it('caps at BURN_CAP', () => {
    applyBurnStacks(zone, 'skel', 99, 'p1', 1000);
    expect(zone.mobs.get('skel')!.burnStacks).toBe(BURN_CAP);
  });

  it('refreshes the expiry on each application', () => {
    applyBurnStacks(zone, 'skel', 1, 'p1', 1000);
    expect(zone.mobs.get('skel')!.burnExpiresAt).toBe(1000 + BURN_DURATION_MS);
    applyBurnStacks(zone, 'skel', 1, 'p1', 3000);
    expect(zone.mobs.get('skel')!.burnExpiresAt).toBe(3000 + BURN_DURATION_MS);
  });

  it('is a no-op on dead mobs', () => {
    zone.mobs.get('skel')!.alive = false;
    applyBurnStacks(zone, 'skel', 3, 'p1', 1000);
    expect(zone.mobs.get('skel')!.burnStacks).toBe(0);
  });
});

describe('Burn DoT — stepBurns', () => {
  let zone: ZoneState;
  beforeEach(() => { zone = setup(); });

  it('emits a Damage event each tick interval while stacks are active', () => {
    applyBurnStacks(zone, 'skel', 3, 'p1', 1000);
    const events = stepBurns(zone, 1000 + BURN_TICK_INTERVAL_MS);
    expect(events).toHaveLength(1);
    expect(events[0]!.targetId).toBe('skel');
    expect(events[0]!.amount).toBe(3 * BURN_DAMAGE_PER_STACK);
    expect(events[0]!.attackerId).toBe('p1');
  });

  it('does not double-tick within the same interval', () => {
    applyBurnStacks(zone, 'skel', 2, 'p1', 1000);
    stepBurns(zone, 1000 + BURN_TICK_INTERVAL_MS);
    const events = stepBurns(zone, 1000 + BURN_TICK_INTERVAL_MS + 100);
    expect(events).toEqual([]);
  });

  it('clears stacks after the duration expires', () => {
    applyBurnStacks(zone, 'skel', 3, 'p1', 1000);
    stepBurns(zone, 1000 + BURN_DURATION_MS + 1);
    expect(zone.mobs.get('skel')!.burnStacks).toBe(0);
  });

  it('marks fatal=true when the burn tick is the killing blow', () => {
    applyBurnStacks(zone, 'skel', 5, 'p1', 1000);
    zone.mobs.get('skel')!.hp = 5; // less than 5 * 2 = 10 damage
    const events = stepBurns(zone, 1000 + BURN_TICK_INTERVAL_MS);
    expect(events).toHaveLength(1);
    expect(events[0]!.fatal).toBe(true);
    expect(zone.mobs.get('skel')!.alive).toBe(false);
  });

  it('does not tick a dead mob', () => {
    applyBurnStacks(zone, 'skel', 5, 'p1', 1000);
    zone.mobs.get('skel')!.alive = false;
    const events = stepBurns(zone, 1000 + BURN_TICK_INTERVAL_MS);
    expect(events).toEqual([]);
  });
});

describe('Burn DoT — detonateBurns', () => {
  let zone: ZoneState;
  beforeEach(() => { zone = setup(); });

  it('returns total damage based on stacks and clears them', () => {
    applyBurnStacks(zone, 'skel', 4, 'p1', 1000);
    const damage = detonateBurns(zone, 'skel', 6);
    expect(damage).toBe(24);
    expect(zone.mobs.get('skel')!.burnStacks).toBe(0);
  });

  it('returns 0 if no stacks are present', () => {
    expect(detonateBurns(zone, 'skel', 6)).toBe(0);
  });

  it('returns 0 for unknown mob id', () => {
    expect(detonateBurns(zone, 'no-mob', 6)).toBe(0);
  });
});

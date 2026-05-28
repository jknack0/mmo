import { describe, it, expect, beforeEach } from 'vitest';
import {
  createZoneState,
  spawnPlayer,
  spawnMob,
  setPlayerTarget,
  type ZoneState,
} from '../zone/zone-state.js';
import {
  engageTarget,
  disengage,
  advancePlayerCombat,
  SKILL_DEFS,
} from './combat-system.js';

const OPEN_MAP = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => 0));

function fresh(): ZoneState {
  const zone = createZoneState({ size: { x: 20, y: 20 }, tileMap: OPEN_MAP });
  spawnPlayer(zone, { id: 'p1', characterId: 'c1', name: 'Alice', pos: { x: 5, y: 5 } });
  spawnMob(zone, { id: 'skel', kind: 'skeleton', pos: { x: 6, y: 5 }, maxHp: 40, respawnMs: 5000 });
  return zone;
}

describe('PlayerAttackState — engageTarget', () => {
  let zone: ZoneState;
  beforeEach(() => { zone = fresh(); });

  it('a fresh player starts in the idle state', () => {
    expect(zone.players.get('p1')!.attackState).toEqual({ kind: 'idle' });
  });

  it('engageTarget transitions an idle player to chasing', () => {
    const ok = engageTarget(zone, 'p1', 'skel', 'basic-attack');
    expect(ok).toBe(true);
    expect(zone.players.get('p1')!.attackState).toEqual({
      kind: 'chasing', targetId: 'skel', skillId: 'basic-attack',
    });
  });

  it('engageTarget refuses an unknown skill', () => {
    expect(engageTarget(zone, 'p1', 'skel', 'no-such-skill')).toBe(false);
    expect(zone.players.get('p1')!.attackState).toEqual({ kind: 'idle' });
  });

  it('engageTarget refuses a missing player', () => {
    expect(engageTarget(zone, 'ghost', 'skel', 'basic-attack')).toBe(false);
  });

  it('engageTarget refuses a missing target', () => {
    expect(engageTarget(zone, 'p1', 'no-mob', 'basic-attack')).toBe(false);
    expect(zone.players.get('p1')!.attackState).toEqual({ kind: 'idle' });
  });

  it('engageTarget refuses a dead target', () => {
    zone.mobs.get('skel')!.alive = false;
    expect(engageTarget(zone, 'p1', 'skel', 'basic-attack')).toBe(false);
  });
});

describe('PlayerAttackState — advancePlayerCombat', () => {
  let zone: ZoneState;
  beforeEach(() => { zone = fresh(); });

  it('returns nothing when the player is idle', () => {
    expect(advancePlayerCombat(zone, 'p1', 1000)).toEqual([]);
  });

  it('transitions chasing → in-range-attacking when within skill range', () => {
    engageTarget(zone, 'p1', 'skel', 'basic-attack');
    // player at (5,5), mob at (6,5) → distance 1 ≤ range 2.
    advancePlayerCombat(zone, 'p1', 1000);
    expect(zone.players.get('p1')!.attackState.kind).toBe('in-range-attacking');
  });

  it('stays chasing and sets player.target toward the mob if out of range', () => {
    zone.players.get('p1')!.pos = { x: 0, y: 0 };
    engageTarget(zone, 'p1', 'skel', 'basic-attack');
    advancePlayerCombat(zone, 'p1', 1000);
    const p = zone.players.get('p1')!;
    expect(p.attackState.kind).toBe('chasing');
    expect(p.target).toEqual({ x: 6, y: 5 });
  });

  it('emits a Damage event on the first in-range tick when the skill is off cooldown', () => {
    engageTarget(zone, 'p1', 'skel', 'basic-attack');
    const events = advancePlayerCombat(zone, 'p1', 1000);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.targetId).toBe('skel');
    expect(ev.attackerId).toBe('p1');
    expect(ev.amount).toBe(SKILL_DEFS['basic-attack']!.damage);
    expect(ev.fatal).toBe(false);
  });

  it('does not emit a Damage event while on cooldown', () => {
    engageTarget(zone, 'p1', 'skel', 'basic-attack');
    advancePlayerCombat(zone, 'p1', 1000); // first attack fires here
    const events = advancePlayerCombat(zone, 'p1', 1100); // still on cd
    expect(events).toEqual([]);
  });

  it('fires again after the cooldown expires', () => {
    engageTarget(zone, 'p1', 'skel', 'basic-attack');
    advancePlayerCombat(zone, 'p1', 1000);
    const cd = SKILL_DEFS['basic-attack']!.cooldownMs;
    const events = advancePlayerCombat(zone, 'p1', 1000 + cd + 1);
    expect(events).toHaveLength(1);
  });

  it('transitions back to chasing when the mob moves out of range mid-fight', () => {
    engageTarget(zone, 'p1', 'skel', 'basic-attack');
    advancePlayerCombat(zone, 'p1', 1000);
    expect(zone.players.get('p1')!.attackState.kind).toBe('in-range-attacking');
    zone.mobs.get('skel')!.pos = { x: 19, y: 19 };
    advancePlayerCombat(zone, 'p1', 2000);
    expect(zone.players.get('p1')!.attackState.kind).toBe('chasing');
  });

  it('transitions to idle and stops chasing when the target dies (fatal hit)', () => {
    // Skeleton has 40 HP, basic-attack does 12. Set HP to 1 so the next hit is fatal.
    zone.mobs.get('skel')!.hp = 1;
    engageTarget(zone, 'p1', 'skel', 'basic-attack');
    const events = advancePlayerCombat(zone, 'p1', 1000);
    expect(events[0]!.fatal).toBe(true);
    // Next tick the player should disengage.
    advancePlayerCombat(zone, 'p1', 1100);
    expect(zone.players.get('p1')!.attackState).toEqual({ kind: 'idle' });
  });

  it('transitions to idle when the target despawns', () => {
    engageTarget(zone, 'p1', 'skel', 'basic-attack');
    zone.mobs.delete('skel');
    advancePlayerCombat(zone, 'p1', 1000);
    expect(zone.players.get('p1')!.attackState).toEqual({ kind: 'idle' });
  });
});

describe('PlayerAttackState — manual disengage', () => {
  let zone: ZoneState;
  beforeEach(() => { zone = fresh(); });

  it('disengage clears any active attack state', () => {
    engageTarget(zone, 'p1', 'skel', 'basic-attack');
    disengage(zone, 'p1');
    expect(zone.players.get('p1')!.attackState).toEqual({ kind: 'idle' });
  });

  it('clicking-to-move (setPlayerTarget) cancels stickiness', () => {
    engageTarget(zone, 'p1', 'skel', 'basic-attack');
    setPlayerTarget(zone, 'p1', { x: 12, y: 12 });
    expect(zone.players.get('p1')!.attackState).toEqual({ kind: 'idle' });
    expect(zone.players.get('p1')!.target).toEqual({ x: 12, y: 12 });
  });
});

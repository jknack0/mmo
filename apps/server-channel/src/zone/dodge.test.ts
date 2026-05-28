import { describe, it, expect, beforeEach } from 'vitest';
import {
  createZoneState,
  spawnPlayer,
  performDodge,
  setPlayerTarget,
  DODGE_TILES,
  DODGE_COOLDOWN_MS,
  DODGE_INVUL_MS,
  type ZoneState,
} from './zone-state.js';

const OPEN_MAP = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => 0));

function fresh(): ZoneState {
  const zone = createZoneState({ size: { x: 20, y: 20 }, tileMap: OPEN_MAP });
  spawnPlayer(zone, { id: 'p1', characterId: 'c1', name: 'Alice', pos: { x: 10, y: 10 } });
  return zone;
}

describe('performDodge', () => {
  let zone: ZoneState;
  beforeEach(() => { zone = fresh(); });

  it('dashes the player DODGE_TILES toward the current move target', () => {
    setPlayerTarget(zone, 'p1', { x: 15, y: 10 });
    const ok = performDodge(zone, 'p1', 1000);
    expect(ok).toBe(true);
    const p = zone.players.get('p1')!;
    expect(p.pos.x).toBeCloseTo(10 + DODGE_TILES, 5);
    expect(p.pos.y).toBeCloseTo(10, 5);
    // setPlayerTarget calls (inside the test) cancel attack stickiness already;
    // the dodge resets the move target so the player doesn't keep moving.
    expect(p.target).toBeNull();
  });

  it('sets the dodge invulnerability window', () => {
    performDodge(zone, 'p1', 1000);
    expect(zone.players.get('p1')!.dodgeInvulUntil).toBe(1000 + DODGE_INVUL_MS);
  });

  it('refuses to dodge while on cooldown', () => {
    expect(performDodge(zone, 'p1', 1000)).toBe(true);
    expect(performDodge(zone, 'p1', 1000 + DODGE_COOLDOWN_MS - 1)).toBe(false);
  });

  it('allows another dodge after the cooldown expires', () => {
    performDodge(zone, 'p1', 1000);
    expect(performDodge(zone, 'p1', 1000 + DODGE_COOLDOWN_MS + 1)).toBe(true);
  });

  it('defaults to dashing east when no move target is set', () => {
    performDodge(zone, 'p1', 1000);
    const p = zone.players.get('p1')!;
    expect(p.pos.x).toBeGreaterThan(10);
  });

  it('clamps the landing tile to map bounds', () => {
    zone.players.get('p1')!.pos = { x: 19, y: 10 };
    setPlayerTarget(zone, 'p1', { x: 19, y: 10 }); // east
    performDodge(zone, 'p1', 1000);
    expect(zone.players.get('p1')!.pos.x).toBeLessThanOrEqual(19);
  });
});

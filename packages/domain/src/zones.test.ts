import { describe, it, expect } from 'vitest';
import {
  ZONE_DEFS,
  getZoneDef,
  buildZoneTileMap,
  portalAt,
  HOLD_VERIDIAN,
  ASHEN_PLAINS,
} from './zones.js';

describe('zone definitions', () => {
  it('exposes the two alpha zones', () => {
    expect(getZoneDef(HOLD_VERIDIAN)?.name).toMatch(/veridian/i);
    expect(getZoneDef(ASHEN_PLAINS)?.name).toMatch(/ashen/i);
    expect(getZoneDef('nowhere')).toBeUndefined();
  });

  it('Hold Veridian is a town: cap 100, mob-free, with NPCs', () => {
    const town = getZoneDef(HOLD_VERIDIAN)!;
    expect(town.cap).toBe(100);
    expect(town.mobs).toEqual([]);
    expect(town.npcs.length).toBeGreaterThan(0);
    // The trainers (S12), vendor (S16) and Rift portal (S19) live in town.
    const kinds = town.npcs.map((n) => n.kind);
    expect(kinds).toContain('vendor');
    expect(kinds).toContain('trainer');
    expect(kinds).toContain('rift-portal');
  });

  it('Ashen Plains is open world: cap 50, with mob spawns', () => {
    const open = getZoneDef(ASHEN_PLAINS)!;
    expect(open.cap).toBe(50);
    expect(open.mobs.length).toBeGreaterThan(0);
  });

  it('the two zones portal into each other', () => {
    const town = getZoneDef(HOLD_VERIDIAN)!;
    const open = getZoneDef(ASHEN_PLAINS)!;
    expect(town.portals.some((p) => p.targetZoneId === ASHEN_PLAINS)).toBe(true);
    expect(open.portals.some((p) => p.targetZoneId === HOLD_VERIDIAN)).toBe(true);
  });

  it('every portal target is a real zone', () => {
    for (const def of Object.values(ZONE_DEFS)) {
      for (const p of def.portals) {
        expect(ZONE_DEFS[p.targetZoneId]).toBeDefined();
      }
    }
  });

  it('buildZoneTileMap matches the zone size and walls the border', () => {
    const def = getZoneDef(ASHEN_PLAINS)!;
    const map = buildZoneTileMap(ASHEN_PLAINS);
    expect(map.length).toBe(def.size.y);
    expect(map[0]!.length).toBe(def.size.x);
    expect(map[0]!.every((t) => t === 1)).toBe(true); // top row walled
    expect(map[5]![0]).toBe(1); // left edge walled
    expect(map[5]![5]).toBe(0); // interior walkable
  });

  it('portalAt detects a player standing on a portal and ignores distant ones', () => {
    const open = getZoneDef(ASHEN_PLAINS)!;
    const portal = open.portals[0]!;
    expect(portalAt(open.portals, { x: portal.pos.x + 0.3, y: portal.pos.y })?.id).toBe(portal.id);
    expect(portalAt(open.portals, { x: portal.pos.x + 5, y: portal.pos.y })).toBeUndefined();
  });

  it('portals + npcs sit on walkable interior tiles', () => {
    for (const id of Object.keys(ZONE_DEFS)) {
      const def = ZONE_DEFS[id]!;
      const map = buildZoneTileMap(id);
      for (const e of [...def.portals, ...def.npcs]) {
        expect(map[e.pos.y]![e.pos.x]).toBe(0);
      }
    }
  });
});

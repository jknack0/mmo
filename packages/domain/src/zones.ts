// Zone definitions (S17 #19, ADR-0001/0011). Two alpha zones:
//   - Hold Veridian: the town hub. Cap 100, mob-free (no combat → presence
//     budget), home to the trainers (S12), vendor (S16) and Rift portal (S19).
//   - Ashen Plains: the open-world zone. Cap 50, with mob spawns.
// Zones portal into each other: stepping on a portal tile hands the player off
// to the target zone's channel. Pure, shared data — the channel loads a def to
// build its world, the client reads npcs/portals to render them.

export interface ZonePos {
  x: number;
  y: number;
}

export interface MobDef {
  id: string;
  kind: string;
  pos: ZonePos;
  maxHp: number;
}

export interface PortalDef {
  id: string;
  pos: ZonePos;
  targetZoneId: string;
  label: string;
}

export interface NpcDef {
  id: string;
  /** 'vendor' | 'trainer' | 'rift-portal' — drives the client marker. */
  kind: string;
  pos: ZonePos;
  label: string;
}

export interface ZoneDef {
  zoneId: string;
  name: string;
  size: ZonePos;
  /** Concurrent-player cap (ADR-0011): town 100, open world 50. */
  cap: number;
  mobs: MobDef[];
  portals: PortalDef[];
  npcs: NpcDef[];
  /** Interior wall tiles (x,y) besides the border. */
  rocks: ZonePos[];
}

export const HOLD_VERIDIAN = 'hold-veridian';
export const ASHEN_PLAINS = 'ashen-plains';

const holdVeridian: ZoneDef = {
  zoneId: HOLD_VERIDIAN,
  name: 'Hold Veridian',
  size: { x: 30, y: 30 },
  cap: 100,
  mobs: [], // town: no combat
  npcs: [
    { id: 'vendor-veridian', kind: 'vendor', pos: { x: 12, y: 14 }, label: 'Quartermaster' },
    { id: 'trainer-blade', kind: 'trainer', pos: { x: 16, y: 12 }, label: 'Blademaster' },
    { id: 'trainer-pyro', kind: 'trainer', pos: { x: 19, y: 14 }, label: 'Pyromancer' },
    { id: 'rift-portal', kind: 'rift-portal', pos: { x: 15, y: 9 }, label: 'Rift' },
  ],
  portals: [
    { id: 'to-ashen', pos: { x: 15, y: 26 }, targetZoneId: ASHEN_PLAINS, label: 'Ashen Plains' },
  ],
  rocks: [],
};

const ashenPlains: ZoneDef = {
  zoneId: ASHEN_PLAINS,
  name: 'Ashen Plains',
  size: { x: 30, y: 30 },
  cap: 50,
  mobs: [
    { id: 'skel-1', kind: 'skeleton', pos: { x: 15, y: 8 }, maxHp: 60 },
    { id: 'skel-2', kind: 'skeleton', pos: { x: 18, y: 20 }, maxHp: 60 },
    { id: 'skel-3', kind: 'skeleton', pos: { x: 22, y: 14 }, maxHp: 60 },
  ],
  npcs: [],
  portals: [
    { id: 'to-veridian', pos: { x: 15, y: 4 }, targetZoneId: HOLD_VERIDIAN, label: 'Hold Veridian' },
  ],
  rocks: [
    { x: 10, y: 10 },
    { x: 20, y: 18 },
  ],
};

export const ZONE_DEFS: Record<string, ZoneDef> = {
  [HOLD_VERIDIAN]: holdVeridian,
  [ASHEN_PLAINS]: ashenPlains,
};

export function getZoneDef(zoneId: string): ZoneDef | undefined {
  return ZONE_DEFS[zoneId];
}

/** Default tiles within which a player is considered standing on a portal. */
export const PORTAL_TRIGGER_RADIUS = 0.7;

/** The portal a position is standing on (within radius), if any. */
export function portalAt(
  portals: PortalDef[],
  pos: ZonePos,
  radius: number = PORTAL_TRIGGER_RADIUS
): PortalDef | undefined {
  for (const p of portals) {
    if (Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y) <= radius) return p;
  }
  return undefined;
}

/**
 * Build the collision tile map for a zone: walled border + interior rocks,
 * everything else walkable. 1 = blocked, 0 = walkable.
 */
export function buildZoneTileMap(zoneId: string): number[][] {
  const def = ZONE_DEFS[zoneId];
  if (!def) return [];
  const { x: w, y: h } = def.size;
  const rocks = new Set(def.rocks.map((r) => `${r.x},${r.y}`));
  const map: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      row.push(border || rocks.has(`${x},${y}`) ? 1 : 0);
    }
    map.push(row);
  }
  return map;
}

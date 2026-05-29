// ItemSchema + white base-item catalog (S13 #15). Per ADR-0005 itemization is
// D2-style (White → Magic → … tiers); this slice is WHITE ONLY with flat
// stats — affixes (S14), refinement/tapping (S15) layer on later. Per ADR-0013
// the live item *instances* are server-issued UUID rows in Postgres; this file
// is just the pure, shared definition of what each base grants.

/** Gear slots an item can occupy. `ring` equips into one of two ring slots. */
export type GearSlot =
  | 'weapon'
  | 'off-hand'
  | 'head'
  | 'chest'
  | 'legs'
  | 'feet'
  | 'hands'
  | 'ring'
  | 'neck';

export const GEAR_SLOTS: GearSlot[] = [
  'weapon',
  'off-hand',
  'head',
  'chest',
  'legs',
  'feet',
  'hands',
  'ring',
  'neck',
];

/**
 * Concrete equip positions on the character. Mostly 1:1 with GearSlot, except
 * `ring` fills one of two positions.
 */
export type EquipSlot =
  | 'weapon'
  | 'off-hand'
  | 'head'
  | 'chest'
  | 'legs'
  | 'feet'
  | 'hands'
  | 'ring-1'
  | 'ring-2'
  | 'neck';

export const EQUIP_SLOTS: EquipSlot[] = [
  'weapon',
  'off-hand',
  'head',
  'chest',
  'legs',
  'feet',
  'hands',
  'ring-1',
  'ring-2',
  'neck',
];

/** True when an item of `gearSlot` may be equipped into `equipSlot`. */
export function slotAcceptsBase(equipSlot: string, gearSlot: GearSlot): boolean {
  if (gearSlot === 'ring') return equipSlot === 'ring-1' || equipSlot === 'ring-2';
  return equipSlot === gearSlot;
}

/** Flat stats a base item carries. All optional; only positive values appear. */
export interface ItemStats {
  str?: number;
  dex?: number;
  int?: number;
  vit?: number;
  /** Adds to weapon (basic-attack) damage. Weapons only. */
  weaponDamage?: number;
  /** Mitigation value. Armor pieces / off-hands. */
  armor?: number;
}

export interface ItemBase {
  baseId: string;
  name: string;
  slot: GearSlot;
  stats: ItemStats;
}

const base = (baseId: string, name: string, slot: GearSlot, stats: ItemStats): ItemBase => ({
  baseId,
  name,
  slot,
  stats,
});

export const ITEM_BASES: ItemBase[] = [
  // Weapons — STR melee vs INT caster.
  base('rusty-sword', 'Rusty Sword', 'weapon', { weaponDamage: 5, str: 2 }),
  base('apprentice-wand', 'Apprentice Wand', 'weapon', { weaponDamage: 3, int: 4 }),
  // Off-hands.
  base('wooden-buckler', 'Wooden Buckler', 'off-hand', { armor: 3, str: 1 }),
  base('apprentice-orb', 'Apprentice Orb', 'off-hand', { int: 3 }),
  // Armor pieces.
  base('leather-cap', 'Leather Cap', 'head', { armor: 2, vit: 1 }),
  base('leather-vest', 'Leather Vest', 'chest', { armor: 5, vit: 2 }),
  base('leather-greaves', 'Leather Greaves', 'legs', { armor: 3, vit: 1 }),
  base('leather-boots', 'Leather Boots', 'feet', { armor: 2, dex: 1 }),
  base('leather-gloves', 'Leather Gloves', 'hands', { armor: 2, dex: 1 }),
  // Jewelry — INT-flavored for the alpha Pyromancer.
  base('copper-ring', 'Copper Ring', 'ring', { int: 1 }),
  base('copper-amulet', 'Copper Amulet', 'neck', { int: 2, vit: 1 }),
];

const BASE_BY_ID = new Map(ITEM_BASES.map((b) => [b.baseId, b]));

export function getItemBase(baseId: string): ItemBase | undefined {
  return BASE_BY_ID.get(baseId);
}

export interface AggregatedItemStats {
  str: number;
  dex: number;
  int: number;
  vit: number;
  weaponDamage: number;
  armor: number;
}

export function emptyItemStats(): AggregatedItemStats {
  return { str: 0, dex: 0, int: 0, vit: 0, weaponDamage: 0, armor: 0 };
}

/**
 * Sum the flat stats of the given base ids. Unknown ids are skipped (an item
 * row could reference a base removed in a later patch). Pure — the caller
 * passes the base ids of currently-equipped items.
 */
export function aggregateItemStats(baseIds: string[]): AggregatedItemStats {
  const out = emptyItemStats();
  for (const id of baseIds) {
    const b = BASE_BY_ID.get(id);
    if (!b) continue;
    const s = b.stats;
    out.str += s.str ?? 0;
    out.dex += s.dex ?? 0;
    out.int += s.int ?? 0;
    out.vit += s.vit ?? 0;
    out.weaponDamage += s.weaponDamage ?? 0;
    out.armor += s.armor ?? 0;
  }
  return out;
}

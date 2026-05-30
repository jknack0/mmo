// ItemSchema + white base-item catalog (S13 #15). Per ADR-0005 itemization is
// D2-style (White → Magic → … tiers); this slice is WHITE ONLY with flat
// stats — affixes (S14), refinement/tapping (S15) layer on later. Per ADR-0013
// the live item *instances* are server-issued UUID rows in Postgres; this file
// is just the pure, shared definition of what each base grants.

import {
  rarityForAffixCount,
  type Rarity,
  type RolledAffix,
} from './affixes.js';
import { refinementMultiplier } from './refinement.js';

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
  /** Unique (gold) chase item — fixed affixes in UNIQUE_AFFIXES. */
  unique?: boolean;
}

const base = (baseId: string, name: string, slot: GearSlot, stats: ItemStats): ItemBase => ({
  baseId,
  name,
  slot,
  stats,
});

const unique = (baseId: string, name: string, slot: GearSlot, stats: ItemStats): ItemBase => ({
  baseId,
  name,
  slot,
  stats,
  unique: true,
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
  // ── Uniques (gold) — fixed-stat chase items (S14). ──
  unique('cinderheart', 'Cinderheart', 'neck', { int: 3, vit: 2 }),
  unique('emberfang', 'Emberfang', 'weapon', { weaponDamage: 6, int: 3 }),
];

/** Unique base ids — what a gold roll selects from. */
export const UNIQUE_BASE_IDS: string[] = ITEM_BASES.filter((b) => b.unique).map((b) => b.baseId);

const rolled = (templateId: string, kind: 'stat' | 'skill', value: number, text: string, stat?: RolledAffix['stat']): RolledAffix =>
  ({ templateId, kind, value, text, stat });

/** Fixed affixes each unique always carries (ADR-0005 named uniques). */
export const UNIQUE_AFFIXES: Record<string, RolledAffix[]> = {
  cinderheart: [
    rolled('fire-pct', 'stat', 15, '+15% Fire damage', 'firePct'),
    rolled('int-flat', 'stat', 10, '+10 Intelligence', 'int'),
    rolled('plus-pyro-skills', 'skill', 1, '+1 to Pyromancy skills'),
  ],
  emberfang: [
    rolled('fire-pct', 'stat', 12, '+12% Fire damage', 'firePct'),
    rolled('fireball-pct', 'skill', 20, 'Fireball deals +20% damage'),
  ],
};

const BASE_BY_ID = new Map(ITEM_BASES.map((b) => [b.baseId, b]));

/** An item's rarity: gold if its base is unique, else by affix count. */
export function rarityOf(baseId: string, affixCount: number): Rarity {
  return BASE_BY_ID.get(baseId)?.unique ? 'gold' : rarityForAffixCount(affixCount);
}

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
  /** Summed +Fire damage % from affixes (percentage points). */
  firePct: number;
}

export function emptyItemStats(): AggregatedItemStats {
  return { str: 0, dex: 0, int: 0, vit: 0, weaponDamage: 0, armor: 0, firePct: 0 };
}

/**
 * Sum the flat stats of the given base ids. Unknown ids are skipped (an item
 * row could reference a base removed in a later patch). Pure — the caller
 * passes the base ids of currently-equipped items.
 */
export function aggregateItemStats(baseIds: string[]): AggregatedItemStats {
  return aggregateEquipped(baseIds.map((baseId) => ({ baseId, affixes: [], refinement: 0 })));
}

/** An equipped item instance: base + rolled affixes + Refinement level (S15). */
export interface EquippedInstance {
  baseId: string;
  affixes: RolledAffix[];
  refinement?: number;
}

/**
 * Sum base stats + stat-affix values across equipped instances. Every numeric
 * stat on an item is scaled by its Refinement multiplier (S15) before summing;
 * each scaled contribution rounds to the nearest integer. Skill affixes carry
 * no `stat` and are skipped (tooltip-only).
 */
export function aggregateEquipped(items: EquippedInstance[]): AggregatedItemStats {
  const out = emptyItemStats();
  const addStat = (stat: string | undefined, value: number) => {
    switch (stat) {
      case 'str': out.str += value; break;
      case 'dex': out.dex += value; break;
      case 'int': out.int += value; break;
      case 'vit': out.vit += value; break;
      case 'weaponDamage': out.weaponDamage += value; break;
      case 'armor': out.armor += value; break;
      case 'firePct': out.firePct += value; break;
    }
  };
  for (const item of items) {
    const mult = refinementMultiplier(item.refinement ?? 0);
    const scale = (v: number) => Math.round(v * mult);
    const b = BASE_BY_ID.get(item.baseId);
    if (b) {
      out.str += scale(b.stats.str ?? 0);
      out.dex += scale(b.stats.dex ?? 0);
      out.int += scale(b.stats.int ?? 0);
      out.vit += scale(b.stats.vit ?? 0);
      out.weaponDamage += scale(b.stats.weaponDamage ?? 0);
      out.armor += scale(b.stats.armor ?? 0);
    }
    for (const aff of item.affixes ?? []) {
      if (aff.kind === 'stat') addStat(aff.stat, scale(aff.value));
    }
  }
  return out;
}

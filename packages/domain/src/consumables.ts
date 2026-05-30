// Consumables + vendor economy (S16 #18). Pure, shared definitions:
//   - CONSUMABLES   — usable items (HP potions) and what they do.
//   - VENDOR_CATALOG — what the town vendor sells and for how much gold.
//   - sellValue     — what the vendor pays to buy a player's item back.
//
// Per ADR-0013 the live item *instances* are server-issued UUID rows in
// Postgres; this file is only the rule layer. Gold + audit rows are written by
// the gateway VendorService (buy/sell) and the channel consume path.

import { rarityOf } from './items.js';
import type { Rarity } from './affixes.js';

export interface ConsumableDef {
  baseId: string;
  name: string;
  /** Flat HP restored when the item is used. */
  heal: number;
}

/** Usable items. Health potions restore HP (S16 pulls player HP forward). */
export const CONSUMABLES: ConsumableDef[] = [
  { baseId: 'minor-health-potion', name: 'Minor Health Potion', heal: 50 },
  { baseId: 'health-potion', name: 'Health Potion', heal: 120 },
];

const CONSUMABLE_BY_ID = new Map(CONSUMABLES.map((c) => [c.baseId, c]));

export function isConsumable(baseId: string): boolean {
  return CONSUMABLE_BY_ID.has(baseId);
}

export function getConsumable(baseId: string): ConsumableDef | undefined {
  return CONSUMABLE_BY_ID.get(baseId);
}

/** How a vendor purchase resolves: a granted item, or a materials top-up. */
export type VendorKind = 'item' | 'materials';

export interface VendorEntry {
  baseId: string;
  name: string;
  /** Gold cost to buy one. */
  price: number;
  kind: VendorKind;
  /** Refinement materials granted when kind === 'materials'. */
  materialAmount?: number;
}

export const VENDOR_CATALOG: VendorEntry[] = [
  { baseId: 'minor-health-potion', name: 'Minor Health Potion', price: 15, kind: 'item' },
  { baseId: 'health-potion', name: 'Health Potion', price: 40, kind: 'item' },
  {
    baseId: 'tapping-materials',
    name: 'Tapping Materials ×50',
    price: 50,
    kind: 'materials',
    materialAmount: 50,
  },
];

const VENDOR_BY_ID = new Map(VENDOR_CATALOG.map((e) => [e.baseId, e]));

export function vendorEntry(baseId: string): VendorEntry | undefined {
  return VENDOR_BY_ID.get(baseId);
}

/** Gold a vendor pays per rarity when buying gear back from the player. */
export const SELL_VALUE_BY_RARITY: Record<Rarity, number> = {
  white: 5,
  blue: 15,
  yellow: 40,
  gold: 100,
};

/**
 * What the vendor pays for a player's item. Vendor-stocked consumables sell for
 * a third of their buy price (a gold sink); gear sells by rarity tier so a
 * rolled blue/yellow is worth more than a white base.
 */
export function sellValue(baseId: string, affixCount = 0): number {
  const stocked = VENDOR_BY_ID.get(baseId);
  if (stocked && stocked.kind === 'item') {
    return Math.max(1, Math.floor(stocked.price / 3));
  }
  return SELL_VALUE_BY_RARITY[rarityOf(baseId, affixCount)];
}

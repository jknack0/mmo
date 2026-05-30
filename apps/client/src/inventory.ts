// Client inventory data + HTTP helpers (S13 #15). Item base metadata + slot
// rules come from @mmo/domain so the UI matches the server; the gateway stays
// canonical for what's actually equipped.

export {
  ITEM_BASES,
  EQUIP_SLOTS,
  GEAR_SLOTS,
  getItemBase,
  slotAcceptsBase,
  RARITY_COLOR,
  TAP_COST,
  refinementMultiplier,
  CONSUMABLES,
  VENDOR_CATALOG,
  isConsumable,
  getConsumable,
  vendorEntry,
  sellValue,
  type GearSlot,
  type EquipSlot,
  type ItemBase,
  type Rarity,
  type RolledAffix,
  type ConsumableDef,
  type VendorEntry,
} from '@mmo/domain';
import { getItemBase, getConsumable, vendorEntry } from '@mmo/domain';
import type { RolledAffix, Rarity, VendorEntry } from '@mmo/domain';

/** Human name for any base id — gear, consumable, or vendor-only material bundle. */
export function itemDisplayName(baseId: string): string {
  return (
    getItemBase(baseId)?.name ??
    getConsumable(baseId)?.name ??
    vendorEntry(baseId)?.name ??
    baseId
  );
}

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

export interface InventoryEntry {
  itemId: string;
  baseId: string;
  slot: number;
  affixes: RolledAffix[];
  rarity: Rarity;
  refinement: number;
}
export interface EquippedEntry {
  itemId: string;
  baseId: string;
  gearSlot: string;
  affixes: RolledAffix[];
  rarity: Rarity;
  refinement: number;
}
export interface Attributes {
  str: number;
  dex: number;
  int: number;
  vit: number;
}
export interface InventoryView {
  inventory: InventoryEntry[];
  equipped: EquippedEntry[];
  attributes: Attributes;
  armor: number;
  magicFind: number;
  materials: number;
  gold: number;
}

const EMPTY: InventoryView = {
  inventory: [],
  equipped: [],
  attributes: { str: 0, dex: 0, int: 0, vit: 0 },
  armor: 0,
  magicFind: 0,
  materials: 0,
  gold: 0,
};

export type TapOutcome = 'success' | 'fail' | 'capped';
export type TapResponse =
  | { ok: true; outcome: TapOutcome; refinement: number; pityCounter: number; materials: number }
  | { ok: false; error: string };

export async function tapItem(
  token: string,
  characterId: string,
  itemId: string
): Promise<TapResponse> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/items/${itemId}/tap`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  const body = await res.json();
  if (!res.ok) return { ok: false, error: body.error ?? 'tap-failed' };
  return { ok: true, ...body };
}

export async function fetchInventory(token: string, characterId: string): Promise<InventoryView> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/inventory`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return EMPTY;
  return (await res.json()) as InventoryView;
}

export async function equipItem(
  token: string,
  characterId: string,
  itemId: string,
  gearSlot: string
): Promise<InventoryView | null> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/equip`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ itemId, gearSlot }),
  });
  if (!res.ok) return null;
  return (await res.json()) as InventoryView;
}

export async function unequipItem(
  token: string,
  characterId: string,
  gearSlot: string
): Promise<InventoryView | null> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/unequip`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ gearSlot }),
  });
  if (!res.ok) return null;
  return (await res.json()) as InventoryView;
}

// ─── Vendor (S16 #18) ─────────────────────────────────────────

/** What a buy/sell returns: refreshed bag view fields the vendor screen rerenders. */
export interface VendorView {
  inventory: InventoryEntry[];
  gold: number;
  materials: number;
  /** Gold credited (sell only). */
  value?: number;
}

export async function fetchVendorCatalog(): Promise<VendorEntry[]> {
  const res = await fetch(`${GATEWAY_URL}/vendor`);
  if (!res.ok) return [];
  const body = (await res.json()) as { catalog: VendorEntry[] };
  return body.catalog;
}

export async function buyItem(
  token: string,
  characterId: string,
  baseId: string
): Promise<VendorView | { error: string }> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/vendor/buy`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ baseId }),
  });
  const body = await res.json();
  if (!res.ok) return { error: body.error ?? 'buy-failed' };
  return body as VendorView;
}

export async function sellItem(
  token: string,
  characterId: string,
  itemId: string
): Promise<VendorView | { error: string }> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/vendor/sell`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ itemId }),
  });
  const body = await res.json();
  if (!res.ok) return { error: body.error ?? 'sell-failed' };
  return body as VendorView;
}

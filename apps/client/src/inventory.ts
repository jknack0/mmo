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
  type GearSlot,
  type EquipSlot,
  type ItemBase,
  type Rarity,
  type RolledAffix,
} from '@mmo/domain';
import type { RolledAffix, Rarity } from '@mmo/domain';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

export interface InventoryEntry {
  itemId: string;
  baseId: string;
  slot: number;
  affixes: RolledAffix[];
  rarity: Rarity;
}
export interface EquippedEntry {
  itemId: string;
  baseId: string;
  gearSlot: string;
  affixes: RolledAffix[];
  rarity: Rarity;
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
}

const EMPTY: InventoryView = {
  inventory: [],
  equipped: [],
  attributes: { str: 0, dex: 0, int: 0, vit: 0 },
  armor: 0,
  magicFind: 0,
};

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

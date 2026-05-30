// InventoryRepo (S13 #15) — the canonical home of item instances. Per ADR-0013
// items are server-issued UUIDs (the DB default generates them; the client
// never authors an id) and every move between inventory ↔ equipped runs inside
// a single transaction so an item is never briefly in two places or none.
//
// Invariant: an owned item has exactly one location row — either `inventory`
// (a grid slot) or `equipped` (a gear slot). On-ground items (owner null) have
// neither until picked up.

import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { rarityOf, type RolledAffix, type Rarity } from '@mmo/domain';

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

/** Base + affixes + Refinement of an equipped item — folded by StatCalculator. */
export interface EquippedInstance {
  baseId: string;
  affixes: RolledAffix[];
  refinement: number;
}

export type EquipResult =
  | { ok: true; unequipped: string | null }
  | { ok: false; reason: 'not-in-inventory' };

export interface InventoryRepo {
  createItem(baseId: string, ownerCharacterId: string | null, affixes?: RolledAffix[]): Promise<string>;
  grantItem(characterId: string, baseId: string, affixes?: RolledAffix[]): Promise<{ itemId: string; slot: number }>;
  stashItem(characterId: string, itemId: string): Promise<number>;
  listInventory(characterId: string): Promise<InventoryEntry[]>;
  listEquipped(characterId: string): Promise<EquippedEntry[]>;
  equippedInstances(characterId: string): Promise<EquippedInstance[]>;
  equip(characterId: string, itemId: string, gearSlot: string): Promise<EquipResult>;
  unequip(characterId: string, gearSlot: string): Promise<boolean>;
  getMaterials(characterId: string): Promise<number>;
  getGold(characterId: string): Promise<number>;
}

/** Smallest non-negative slot index not already occupied. */
function firstFreeSlot(used: number[]): number {
  const set = new Set(used);
  let i = 0;
  while (set.has(i)) i++;
  return i;
}

export function createInventoryRepo(db: Kysely<Database>): InventoryRepo {
  async function nextFreeSlot(
    trx: Kysely<Database>,
    characterId: string
  ): Promise<number> {
    const rows = await trx
      .selectFrom('inventory')
      .select('slot')
      .where('character_id', '=', characterId)
      .execute();
    return firstFreeSlot(rows.map((r) => r.slot));
  }

  return {
    async createItem(baseId, ownerCharacterId, affixes = []) {
      const row = await db
        .insertInto('items')
        .values({
          base_id: baseId,
          owner_character_id: ownerCharacterId,
          affixes: JSON.stringify(affixes),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },

    async grantItem(characterId, baseId, affixes = []) {
      const itemId = await this.createItem(baseId, characterId, affixes);
      const slot = await this.stashItem(characterId, itemId);
      return { itemId, slot };
    },

    async stashItem(characterId, itemId) {
      return db.transaction().execute(async (trx) => {
        await trx
          .updateTable('items')
          .set({ owner_character_id: characterId })
          .where('id', '=', itemId)
          .execute();
        const slot = await nextFreeSlot(trx, characterId);
        await trx
          .insertInto('inventory')
          .values({ character_id: characterId, slot, item_id: itemId })
          .execute();
        return slot;
      });
    },

    async listInventory(characterId) {
      const rows = await db
        .selectFrom('inventory')
        .innerJoin('items', 'items.id', 'inventory.item_id')
        .select([
          'inventory.item_id as itemId',
          'items.base_id as baseId',
          'inventory.slot as slot',
          'items.affixes as affixes',
          'items.refinement as refinement',
        ])
        .where('inventory.character_id', '=', characterId)
        .orderBy('inventory.slot')
        .execute();
      return rows.map((r) => {
        const affixes = (r.affixes ?? []) as RolledAffix[];
        return { itemId: r.itemId, baseId: r.baseId, slot: r.slot, affixes, rarity: rarityOf(r.baseId, affixes.length), refinement: r.refinement };
      });
    },

    async listEquipped(characterId) {
      const rows = await db
        .selectFrom('equipped')
        .innerJoin('items', 'items.id', 'equipped.item_id')
        .select([
          'equipped.item_id as itemId',
          'items.base_id as baseId',
          'equipped.gear_slot as gearSlot',
          'items.affixes as affixes',
          'items.refinement as refinement',
        ])
        .where('equipped.character_id', '=', characterId)
        .execute();
      return rows.map((r) => {
        const affixes = (r.affixes ?? []) as RolledAffix[];
        return { itemId: r.itemId, baseId: r.baseId, gearSlot: r.gearSlot, affixes, rarity: rarityOf(r.baseId, affixes.length), refinement: r.refinement };
      });
    },

    async equippedInstances(characterId) {
      const rows = await db
        .selectFrom('equipped')
        .innerJoin('items', 'items.id', 'equipped.item_id')
        .select(['items.base_id as baseId', 'items.affixes as affixes', 'items.refinement as refinement'])
        .where('equipped.character_id', '=', characterId)
        .execute();
      return rows.map((r) => ({ baseId: r.baseId, affixes: (r.affixes ?? []) as RolledAffix[], refinement: r.refinement }));
    },

    async getMaterials(characterId) {
      const row = await db
        .selectFrom('characters')
        .select('materials')
        .where('id', '=', characterId)
        .executeTakeFirst();
      return row?.materials ?? 0;
    },

    async getGold(characterId) {
      const row = await db
        .selectFrom('characters')
        .select('gold')
        .where('id', '=', characterId)
        .executeTakeFirst();
      return row?.gold ?? 0;
    },

    async equip(characterId, itemId, gearSlot) {
      return db.transaction().execute<EquipResult>(async (trx) => {
        const inv = await trx
          .selectFrom('inventory')
          .select('slot')
          .where('character_id', '=', characterId)
          .where('item_id', '=', itemId)
          .executeTakeFirst();
        if (!inv) return { ok: false, reason: 'not-in-inventory' };

        // Pull the incoming item out of inventory, freeing its slot.
        await trx.deleteFrom('inventory').where('item_id', '=', itemId).execute();

        // If something already occupies this gear slot, swap it back to a bag slot.
        const occupant = await trx
          .selectFrom('equipped')
          .select('item_id as itemId')
          .where('character_id', '=', characterId)
          .where('gear_slot', '=', gearSlot)
          .executeTakeFirst();
        let unequipped: string | null = null;
        if (occupant) {
          await trx
            .deleteFrom('equipped')
            .where('character_id', '=', characterId)
            .where('gear_slot', '=', gearSlot)
            .execute();
          const slot = await nextFreeSlot(trx, characterId);
          await trx
            .insertInto('inventory')
            .values({ character_id: characterId, slot, item_id: occupant.itemId })
            .execute();
          unequipped = occupant.itemId;
        }

        await trx
          .insertInto('equipped')
          .values({ character_id: characterId, gear_slot: gearSlot, item_id: itemId })
          .execute();
        return { ok: true, unequipped };
      });
    },

    async unequip(characterId, gearSlot) {
      return db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('equipped')
          .select('item_id as itemId')
          .where('character_id', '=', characterId)
          .where('gear_slot', '=', gearSlot)
          .executeTakeFirst();
        if (!row) return false;
        await trx
          .deleteFrom('equipped')
          .where('character_id', '=', characterId)
          .where('gear_slot', '=', gearSlot)
          .execute();
        const slot = await nextFreeSlot(trx, characterId);
        await trx
          .insertInto('inventory')
          .values({ character_id: characterId, slot, item_id: row.itemId })
          .execute();
        return true;
      });
    },
  };
}

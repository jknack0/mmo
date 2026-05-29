// Channel item-repo (S13 #15) — the write-through item operations the channel
// performs: minting a dropped item (server-issued UUID, owner null), picking it
// up (assign owner + stash in the first free inventory slot), and reading a
// character's equipped base ids to fold into combat stats on Hello.
//
// This intentionally mirrors the gateway's InventoryRepo SQL (which is unit-
// tested against Postgres); kept local to avoid a cross-app import, per the
// established per-app store pattern (tripod-store / passive-store).

import type { Kysely } from 'kysely';
import type { ChannelDatabase } from '../db/types.js';

export interface ChannelItemRepo {
  /** Mint a dropped item with no owner. Returns its server-issued UUID. */
  createDroppedItem(baseId: string): Promise<string>;
  /** Pick up: assign ownership and stash in the first free inventory slot. */
  pickUp(characterId: string, itemId: string): Promise<number>;
  /** Base ids of the character's equipped items (for StatCalculator). */
  equippedBaseIds(characterId: string): Promise<string[]>;
}

function firstFreeSlot(used: number[]): number {
  const set = new Set(used);
  let i = 0;
  while (set.has(i)) i++;
  return i;
}

export function createChannelItemRepo(db: Kysely<ChannelDatabase>): ChannelItemRepo {
  return {
    async createDroppedItem(baseId) {
      const row = await db
        .insertInto('items')
        .values({ base_id: baseId, owner_character_id: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },

    async pickUp(characterId, itemId) {
      return db.transaction().execute(async (trx) => {
        await trx
          .updateTable('items')
          .set({ owner_character_id: characterId })
          .where('id', '=', itemId)
          .execute();
        const rows = await trx
          .selectFrom('inventory')
          .select('slot')
          .where('character_id', '=', characterId)
          .execute();
        const slot = firstFreeSlot(rows.map((r) => r.slot));
        await trx
          .insertInto('inventory')
          .values({ character_id: characterId, slot, item_id: itemId })
          .execute();
        return slot;
      });
    },

    async equippedBaseIds(characterId) {
      const rows = await db
        .selectFrom('equipped')
        .innerJoin('items', 'items.id', 'equipped.item_id')
        .select('items.base_id as baseId')
        .where('equipped.character_id', '=', characterId)
        .execute();
      return rows.map((r) => r.baseId);
    },
  };
}

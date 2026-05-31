// Channel item-repo (S13 #15) — the write-through item operations the channel
// performs: minting a dropped item (server-issued UUID, owner null), picking it
// up (assign owner + stash in the first free inventory slot), and reading a
// character's equipped base ids to fold into combat stats on Hello.
//
// This intentionally mirrors the gateway's InventoryRepo SQL (which is unit-
// tested against Postgres); kept local to avoid a cross-app import, per the
// established per-app store pattern (tripod-store / passive-store).

import { sql, type Kysely } from 'kysely';
import type { ChannelDatabase } from '../db/types.js';
import { getConsumable, rollRiftReward, RIFT_REWARD_MATERIALS, type RolledAffix } from '@mmo/domain';

export interface ChannelEquippedInstance {
  baseId: string;
  affixes: RolledAffix[];
  refinement: number;
}

export interface ChannelItemRepo {
  /** Mint a dropped item with no owner. Returns its server-issued UUID. */
  createDroppedItem(baseId: string, affixes?: RolledAffix[]): Promise<string>;
  /** Pick up: assign ownership and stash in the first free inventory slot. */
  pickUp(characterId: string, itemId: string): Promise<number>;
  /** Equipped items (base + affixes) for StatCalculator on Hello. */
  equippedInstances(characterId: string): Promise<ChannelEquippedInstance[]>;
  /**
   * Use a consumable from inventory (S16): if the carried item is a known
   * consumable, delete it and append an immutable `consume` audit row, all in
   * one transaction. Returns the heal amount, or null when the item isn't
   * carried by this character or isn't consumable.
   */
  consume(
    characterId: string,
    accountId: string | null,
    itemId: string
  ): Promise<{ baseId: string; heal: number } | null>;
  /**
   * Grant the guaranteed Rift boss reward (S20): mint a rarity-rolled item into
   * the bag, top up materials, and append a `rift-reward` audit row — one txn.
   */
  grantRiftReward(
    characterId: string,
    accountId: string | null,
    rng?: () => number
  ): Promise<{ baseId: string; materials: number }>;
}

function firstFreeSlot(used: number[]): number {
  const set = new Set(used);
  let i = 0;
  while (set.has(i)) i++;
  return i;
}

export function createChannelItemRepo(db: Kysely<ChannelDatabase>): ChannelItemRepo {
  return {
    async createDroppedItem(baseId, affixes = []) {
      const row = await db
        .insertInto('items')
        .values({ base_id: baseId, owner_character_id: null, affixes: JSON.stringify(affixes) })
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

    async equippedInstances(characterId) {
      const rows = await db
        .selectFrom('equipped')
        .innerJoin('items', 'items.id', 'equipped.item_id')
        .select(['items.base_id as baseId', 'items.affixes as affixes', 'items.refinement as refinement'])
        .where('equipped.character_id', '=', characterId)
        .execute();
      return rows.map((r) => ({ baseId: r.baseId, affixes: (r.affixes ?? []) as RolledAffix[], refinement: r.refinement }));
    },

    async consume(characterId, accountId, itemId) {
      return db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('inventory')
          .innerJoin('items', 'items.id', 'inventory.item_id')
          .select('items.base_id as baseId')
          .where('inventory.character_id', '=', characterId)
          .where('inventory.item_id', '=', itemId)
          .executeTakeFirst();
        if (!row) return null;
        const consumable = getConsumable(row.baseId);
        if (!consumable) return null;

        // Deleting the item cascades to its inventory row (FK on delete cascade).
        await trx.deleteFrom('items').where('id', '=', itemId).execute();
        await trx
          .insertInto('audit_log')
          .values({
            account_id: accountId,
            character_id: characterId,
            action: 'consume',
            detail: JSON.stringify({ baseId: row.baseId, heal: consumable.heal }),
          })
          .execute();
        return { baseId: row.baseId, heal: consumable.heal };
      });
    },

    async grantRiftReward(characterId, accountId, rng = Math.random) {
      const reward = rollRiftReward(rng);
      return db.transaction().execute(async (trx) => {
        const item = await trx
          .insertInto('items')
          .values({ base_id: reward.baseId, owner_character_id: characterId, affixes: JSON.stringify(reward.affixes) })
          .returning('id')
          .executeTakeFirstOrThrow();
        const rows = await trx
          .selectFrom('inventory')
          .select('slot')
          .where('character_id', '=', characterId)
          .execute();
        await trx
          .insertInto('inventory')
          .values({ character_id: characterId, slot: firstFreeSlot(rows.map((r) => r.slot)), item_id: item.id })
          .execute();
        await trx
          .updateTable('characters')
          .set({ materials: sql`materials + ${RIFT_REWARD_MATERIALS}` })
          .where('id', '=', characterId)
          .execute();
        await trx
          .insertInto('audit_log')
          .values({
            account_id: accountId,
            character_id: characterId,
            action: 'rift-reward',
            detail: JSON.stringify({ baseId: reward.baseId, affixes: reward.affixes.length, materials: RIFT_REWARD_MATERIALS }),
          })
          .execute();
        return { baseId: reward.baseId, materials: RIFT_REWARD_MATERIALS };
      });
    },
  };
}

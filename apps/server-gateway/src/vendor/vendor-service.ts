// VendorService (S16 #18) — the town vendor's buy/sell economy. Per ADR-0013
// every transaction is atomic with its audit row: the gold move, the item
// mint/removal, and the immutable `audit_log` insert all run in one Postgres
// transaction, so gold can never desync from inventory and every trade leaves a
// trail. Item ids stay server-issued (the DB default mints the UUID).

import { Kysely, sql } from 'kysely';
import type { Database } from '../db/types.js';
import { vendorEntry, sellValue, type RolledAffix } from '@mmo/domain';
import { insertAudit } from '../audit/audit-repo.js';

export type BuyResult =
  | { ok: true; gold: number }
  | { ok: false; reason: 'unknown-item' | 'insufficient-gold' };

export type SellResult =
  | { ok: true; gold: number; value: number }
  | { ok: false; reason: 'not-in-inventory' };

export interface VendorService {
  buy(characterId: string, accountId: string, baseId: string): Promise<BuyResult>;
  sell(characterId: string, accountId: string, itemId: string): Promise<SellResult>;
}

function firstFreeSlot(used: number[]): number {
  const set = new Set(used);
  let i = 0;
  while (set.has(i)) i++;
  return i;
}

export function createVendorService(db: Kysely<Database>): VendorService {
  return {
    async buy(characterId, accountId, baseId) {
      const entry = vendorEntry(baseId);
      if (!entry) return { ok: false, reason: 'unknown-item' };

      return db.transaction().execute<BuyResult>(async (trx) => {
        const chr = await trx
          .selectFrom('characters')
          .select('gold')
          .where('id', '=', characterId)
          .executeTakeFirstOrThrow();
        if (chr.gold < entry.price) return { ok: false, reason: 'insufficient-gold' };

        const gold = chr.gold - entry.price;
        await trx
          .updateTable('characters')
          .set({ gold })
          .where('id', '=', characterId)
          .execute();

        if (entry.kind === 'materials') {
          await trx
            .updateTable('characters')
            .set({ materials: sql`materials + ${entry.materialAmount ?? 0}` })
            .where('id', '=', characterId)
            .execute();
        } else {
          const item = await trx
            .insertInto('items')
            .values({ base_id: baseId, owner_character_id: characterId, affixes: '[]' })
            .returning('id')
            .executeTakeFirstOrThrow();
          const rows = await trx
            .selectFrom('inventory')
            .select('slot')
            .where('character_id', '=', characterId)
            .execute();
          const slot = firstFreeSlot(rows.map((r) => r.slot));
          await trx
            .insertInto('inventory')
            .values({ character_id: characterId, slot, item_id: item.id })
            .execute();
        }

        await insertAudit(trx, {
          action: 'vendor-buy',
          accountId,
          characterId,
          detail: { baseId, price: entry.price, kind: entry.kind },
        });
        return { ok: true, gold };
      });
    },

    async sell(characterId, accountId, itemId) {
      return db.transaction().execute<SellResult>(async (trx) => {
        const row = await trx
          .selectFrom('inventory')
          .innerJoin('items', 'items.id', 'inventory.item_id')
          .select(['items.base_id as baseId', 'items.affixes as affixes'])
          .where('inventory.character_id', '=', characterId)
          .where('inventory.item_id', '=', itemId)
          .executeTakeFirst();
        if (!row) return { ok: false, reason: 'not-in-inventory' };

        const affixCount = ((row.affixes ?? []) as RolledAffix[]).length;
        const value = sellValue(row.baseId, affixCount);

        // Deleting the item cascades to its inventory row (FK on delete cascade).
        await trx.deleteFrom('items').where('id', '=', itemId).execute();

        const chr = await trx
          .selectFrom('characters')
          .select('gold')
          .where('id', '=', characterId)
          .executeTakeFirstOrThrow();
        const gold = chr.gold + value;
        await trx
          .updateTable('characters')
          .set({ gold })
          .where('id', '=', characterId)
          .execute();

        await insertAudit(trx, {
          action: 'vendor-sell',
          accountId,
          characterId,
          detail: { itemId, baseId: row.baseId, value },
        });
        return { ok: true, gold, value };
      });
    },
  };
}

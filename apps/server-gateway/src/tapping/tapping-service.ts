// TappingService (S15 #17) — the only way an item's Refinement changes. Deep
// module: pure rule logic (resolveTap from @mmo/domain) wrapped in a single
// Postgres transaction so material-consume + refinement/pity-update are atomic
// (ADR-0013 — a tap is a high-value event). A failed tap still consumes
// materials; a capped/insufficient attempt consumes nothing.

import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import {
  resolveTap,
  refinementCap,
  rarityOf,
  TAP_COST,
  type RolledAffix,
  type TapOutcome,
} from '@mmo/domain';

export type TapResult =
  | { ok: true; outcome: TapOutcome; refinement: number; pityCounter: number; materials: number }
  | { ok: false; error: 'not-found' | 'not-owner' | 'insufficient-materials' };

export interface TappingService {
  attemptRefinement(itemId: string, accountId: string, rng?: () => number): Promise<TapResult>;
}

export function createTappingService(db: Kysely<Database>): TappingService {
  return {
    async attemptRefinement(itemId, accountId, rng = Math.random) {
      return db.transaction().execute<TapResult>(async (trx) => {
        // Load the item with its owning character + materials, under the txn.
        const row = await trx
          .selectFrom('items')
          .innerJoin('characters', 'characters.id', 'items.owner_character_id')
          .select([
            'items.id as itemId',
            'items.base_id as baseId',
            'items.affixes as affixes',
            'items.refinement as refinement',
            'items.pity_counter as pity',
            'characters.id as characterId',
            'characters.account_id as accountId',
            'characters.materials as materials',
          ])
          .where('items.id', '=', itemId)
          .executeTakeFirst();

        if (!row) return { ok: false, error: 'not-found' };
        if (row.accountId !== accountId) return { ok: false, error: 'not-owner' };

        const affixes = (row.affixes ?? []) as RolledAffix[];
        const cap = refinementCap(rarityOf(row.baseId, affixes.length));

        // Capped: nothing spent, no change.
        if (row.refinement >= cap) {
          return {
            ok: true,
            outcome: 'capped',
            refinement: row.refinement,
            pityCounter: row.pity,
            materials: row.materials,
          };
        }
        if (row.materials < TAP_COST) {
          return { ok: false, error: 'insufficient-materials' };
        }

        const result = resolveTap({
          refinement: row.refinement,
          pityCounter: row.pity,
          cap,
          roll: rng(),
        });

        // An attempt (success or fail) always consumes materials.
        const materials = row.materials - TAP_COST;
        await trx
          .updateTable('characters')
          .set({ materials })
          .where('id', '=', row.characterId)
          .execute();
        await trx
          .updateTable('items')
          .set({ refinement: result.newRefinement, pity_counter: result.pityCounter })
          .where('id', '=', itemId)
          .execute();

        return {
          ok: true,
          outcome: result.outcome,
          refinement: result.newRefinement,
          pityCounter: result.pityCounter,
          materials,
        };
      });
    },
  };
}

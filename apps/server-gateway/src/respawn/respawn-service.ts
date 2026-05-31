// RespawnService (S18 #20, ADR-0008). Open-world death is cheap: deduct a small
// gold "repair" cost (clamped to what the player holds — never negative), write
// an immutable audit row, and report the safe town to wake up in. No XP loss.
// One transaction so gold + audit can't desync.

import { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { respawnCost, SAFE_ZONE_ID } from '@mmo/domain';
import { insertAudit } from '../audit/audit-repo.js';

export interface RespawnResult {
  gold: number;
  cost: number;
  zoneId: string;
}

export interface RespawnService {
  respawn(characterId: string, accountId: string): Promise<RespawnResult>;
}

export function createRespawnService(db: Kysely<Database>): RespawnService {
  return {
    async respawn(characterId, accountId) {
      return db.transaction().execute(async (trx) => {
        const chr = await trx
          .selectFrom('characters')
          .select('gold')
          .where('id', '=', characterId)
          .executeTakeFirstOrThrow();
        const cost = respawnCost(chr.gold);
        const gold = chr.gold - cost;
        await trx.updateTable('characters').set({ gold }).where('id', '=', characterId).execute();
        await insertAudit(trx, {
          action: 'respawn',
          accountId,
          characterId,
          detail: { cost, zoneId: SAFE_ZONE_ID },
        });
        return { gold, cost, zoneId: SAFE_ZONE_ID };
      });
    },
  };
}

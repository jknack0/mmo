import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createDb } from '../db/client.js';
import { env } from '../env.js';
import type { Database } from '../db/types.js';
import { createAuditRepo, type AuditRepo } from '../audit/audit-repo.js';
import { createRespawnService, type RespawnService } from './respawn-service.js';
import { RESPAWN_GOLD_COST, SAFE_ZONE_ID } from '@mmo/domain';

describe('RespawnService', () => {
  let db: Kysely<Database>;
  let audit: AuditRepo;
  let svc: RespawnService;
  let accountId: string;
  let characterId: string;

  beforeAll(() => {
    db = createDb(env.databaseUrl);
    audit = createAuditRepo(db);
    svc = createRespawnService(db);
  });
  afterAll(async () => {
    await db.destroy();
  });
  beforeEach(async () => {
    await db.deleteFrom('audit_log').execute();
    await db.deleteFrom('characters').execute();
    await db.deleteFrom('accounts').execute();
    const acct = await db
      .insertInto('accounts')
      .values({ email: 'rs@example.com', discord_id: null, password_hash: 'x' })
      .returning('id')
      .executeTakeFirstOrThrow();
    accountId = acct.id;
    const chr = await db
      .insertInto('characters')
      .values({ account_id: accountId, name: 'Faller', gold: 100 })
      .returning('id')
      .executeTakeFirstOrThrow();
    characterId = chr.id;
  });

  const goldOf = async () =>
    (await db.selectFrom('characters').select('gold').where('id', '=', characterId).executeTakeFirstOrThrow()).gold;

  it('deducts the repair cost, points to town, and writes an audit row', async () => {
    const res = await svc.respawn(characterId, accountId);
    expect(res).toEqual({ gold: 100 - RESPAWN_GOLD_COST, cost: RESPAWN_GOLD_COST, zoneId: SAFE_ZONE_ID });
    expect(await goldOf()).toBe(100 - RESPAWN_GOLD_COST);
    const rows = await audit.list(characterId);
    expect(rows.some((r) => r.action === 'respawn')).toBe(true);
  });

  it('never charges more gold than the player holds (no negative balance)', async () => {
    await db.updateTable('characters').set({ gold: 10 }).where('id', '=', characterId).execute();
    const res = await svc.respawn(characterId, accountId);
    expect(res.cost).toBe(10);
    expect(res.gold).toBe(0);
    expect(await goldOf()).toBe(0);
  });
});

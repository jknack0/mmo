import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createChannelDb } from '../db/client.js';
import type { ChannelDatabase } from '../db/types.js';
import { createChannelItemRepo, type ChannelItemRepo } from './item-repo.js';
import { RIFT_REWARD_MATERIALS } from '@mmo/domain';

const DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://mmo:mmo@localhost:5432/mmo_test';

describe('grantRiftReward (S20)', () => {
  let db: Kysely<ChannelDatabase>;
  let repo: ChannelItemRepo;
  let accountId: string;
  let characterId: string;

  beforeAll(() => {
    db = createChannelDb(DB_URL);
    repo = createChannelItemRepo(db);
  });
  afterAll(async () => {
    await db.destroy();
  });
  beforeEach(async () => {
    // Scope cleanup to our own account so we don't race parallel Postgres suites
    // sharing mmo_test (cascades to this character's items/inventory/audit rows).
    await sql`DELETE FROM accounts WHERE email = 'rr@e.com'`.execute(db);
    const acct = await sql<{ id: string }>`INSERT INTO accounts (email, password_hash) VALUES ('rr@e.com','x') RETURNING id`.execute(db);
    accountId = acct.rows[0]!.id;
    const chr = await sql<{ id: string }>`INSERT INTO characters (account_id, name, materials) VALUES (${accountId}, 'Slayer', 100) RETURNING id`.execute(db);
    characterId = chr.rows[0]!.id;
  });

  it('mints an item into the bag, tops up materials, and writes an audit row', async () => {
    const res = await repo.grantRiftReward(characterId, accountId, () => 0.5);
    expect(res.baseId.length).toBeGreaterThan(0);
    expect(res.materials).toBe(RIFT_REWARD_MATERIALS);

    const inv = await db.selectFrom('inventory').selectAll().where('character_id', '=', characterId).execute();
    expect(inv).toHaveLength(1);

    const mats = await sql<{ materials: number }>`SELECT materials FROM characters WHERE id = ${characterId}`.execute(db);
    expect(mats.rows[0]!.materials).toBe(100 + RIFT_REWARD_MATERIALS);

    const audit = await db.selectFrom('audit_log').selectAll().where('character_id', '=', characterId).where('action', '=', 'rift-reward').execute();
    expect(audit).toHaveLength(1);
  });
});

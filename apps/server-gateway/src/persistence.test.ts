import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createDb } from './db/client.js';
import { env } from './env.js';
import type { Database } from './db/types.js';
import { createInventoryRepo, type InventoryRepo } from './inventory/inventory-repo.js';

// S21 (#23, ADR-0013): high-value events commit synchronously in a Postgres
// transaction (no half-state on a mid-event crash) and item ids are
// server-issued UUIDs the client can never author.
describe('write-through persistence guarantees', () => {
  let db: Kysely<Database>;
  let repo: InventoryRepo;
  let characterId: string;

  beforeAll(() => {
    db = createDb(env.databaseUrl);
    repo = createInventoryRepo(db);
  });
  afterAll(async () => {
    await db.destroy();
  });
  beforeEach(async () => {
    await db.deleteFrom('items').execute();
    await db.deleteFrom('characters').execute();
    await db.deleteFrom('accounts').execute();
    const acct = await db
      .insertInto('accounts')
      .values({ email: 'p@e.com', discord_id: null, password_hash: 'x' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const chr = await db
      .insertInto('characters')
      .values({ account_id: acct.id, name: 'Persist', gold: 100 })
      .returning('id')
      .executeTakeFirstOrThrow();
    characterId = chr.id;
  });

  const goldOf = async () =>
    (await db.selectFrom('characters').select('gold').where('id', '=', characterId).executeTakeFirstOrThrow()).gold;

  it('a transaction that throws mid-event commits nothing (crash → no half-state)', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await trx.updateTable('characters').set({ gold: 1 }).where('id', '=', characterId).execute();
        // Simulate a crash after the gold move but before the rest of the event.
        throw new Error('boom mid-event');
      })
    ).rejects.toThrow('boom');
    expect(await goldOf()).toBe(100); // rolled back — never 1
  });

  it('item ids are server-issued UUIDs, never client-authored', async () => {
    const a = await repo.grantItem(characterId, 'leather-vest');
    const b = await repo.grantItem(characterId, 'rusty-sword');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(a.itemId).toMatch(uuid);
    expect(b.itemId).toMatch(uuid);
    expect(a.itemId).not.toBe(b.itemId);
    // The grant API takes no id argument — the client cannot supply one.
    expect(repo.grantItem.length).toBeLessThanOrEqual(3); // (characterId, baseId, affixes?)
  });
});

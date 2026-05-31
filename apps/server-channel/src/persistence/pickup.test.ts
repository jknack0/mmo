import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createChannelDb } from '../db/client.js';
import type { ChannelDatabase } from '../db/types.js';
import { createChannelItemRepo, type ChannelItemRepo } from './item-repo.js';

const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://mmo:mmo@localhost:5432/mmo_test';

// S21 (#23): the drop→pickup write-through flow against real Postgres. A dropped
// item exists with no owner; pickup assigns ownership + stashes it in a bag slot.
describe('drop → pickup write-through (S21)', () => {
  let db: Kysely<ChannelDatabase>;
  let repo: ChannelItemRepo;
  let characterId: string;

  beforeAll(() => {
    db = createChannelDb(DB_URL);
    repo = createChannelItemRepo(db);
  });
  afterAll(async () => {
    await db.destroy();
  });
  beforeEach(async () => {
    await sql`DELETE FROM accounts WHERE email = 'pk@e.com'`.execute(db);
    const acct = await sql<{ id: string }>`INSERT INTO accounts (email, password_hash) VALUES ('pk@e.com','x') RETURNING id`.execute(db);
    const chr = await sql<{ id: string }>`INSERT INTO characters (account_id, name) VALUES (${acct.rows[0]!.id}, 'Looter') RETURNING id`.execute(db);
    characterId = chr.rows[0]!.id;
  });

  it('a dropped item has no owner until pickup assigns one + stashes it', async () => {
    const itemId = await repo.createDroppedItem('copper-ring');
    const dropped = await sql<{ owner: string | null }>`SELECT owner_character_id as owner FROM items WHERE id = ${itemId}`.execute(db);
    expect(dropped.rows[0]!.owner).toBeNull(); // on the ground

    const slot = await repo.pickUp(characterId, itemId);
    expect(slot).toBe(0);
    const owned = await sql<{ owner: string }>`SELECT owner_character_id as owner FROM items WHERE id = ${itemId}`.execute(db);
    expect(owned.rows[0]!.owner).toBe(characterId);
    const inv = await db.selectFrom('inventory').selectAll().where('item_id', '=', itemId).execute();
    expect(inv).toHaveLength(1);
  });
});

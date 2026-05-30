import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { createChannelDb } from '../db/client.js';
import type { ChannelDatabase } from '../db/types.js';
import { createChannelItemRepo, type ChannelItemRepo } from './item-repo.js';

const DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://mmo:mmo@localhost:5432/mmo_test';

describe('ChannelItemRepo.consume (S16)', () => {
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
    await sql`DELETE FROM audit_log`.execute(db);
    await sql`DELETE FROM accounts`.execute(db); // cascades to characters + items + inventory
    const acct = await sql<{ id: string }>`
      INSERT INTO accounts (email, password_hash) VALUES ('drink@example.com', 'x') RETURNING id
    `.execute(db);
    accountId = acct.rows[0]!.id;
    const chr = await sql<{ id: string }>`
      INSERT INTO characters (account_id, name) VALUES (${accountId}, 'Drinker') RETURNING id
    `.execute(db);
    characterId = chr.rows[0]!.id;
  });

  async function grantToInventory(baseId: string): Promise<string> {
    const itemId = await repo.createDroppedItem(baseId);
    await repo.pickUp(characterId, itemId);
    return itemId;
  }

  const auditRows = () =>
    db.selectFrom('audit_log').selectAll().where('character_id', '=', characterId).execute();
  const itemRows = () => db.selectFrom('items').selectAll().execute();
  const invRows = () =>
    db.selectFrom('inventory').selectAll().where('character_id', '=', characterId).execute();

  it('consumes a health potion, deletes it, and writes a consume audit row', async () => {
    const itemId = await grantToInventory('health-potion');
    const res = await repo.consume(characterId, accountId, itemId);
    expect(res).toEqual({ baseId: 'health-potion', heal: 120 });
    expect(await itemRows()).toHaveLength(0);
    expect(await invRows()).toHaveLength(0);
    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe('consume');
  });

  it('refuses to consume non-consumable gear', async () => {
    const itemId = await grantToInventory('rusty-sword');
    const res = await repo.consume(characterId, accountId, itemId);
    expect(res).toBeNull();
    expect(await itemRows()).toHaveLength(1); // untouched
    expect(await auditRows()).toHaveLength(0);
  });

  it('refuses to consume an item the character does not carry', async () => {
    const res = await repo.consume(characterId, accountId, '00000000-0000-0000-0000-000000000000');
    expect(res).toBeNull();
  });
});

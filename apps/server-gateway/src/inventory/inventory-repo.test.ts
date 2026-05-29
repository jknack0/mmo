import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createDb } from '../db/client.js';
import { env } from '../env.js';
import type { Database } from '../db/types.js';
import { createInventoryRepo, type InventoryRepo } from './inventory-repo.js';

describe('InventoryRepo', () => {
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
      .values({ email: 'inv@example.com', discord_id: null, password_hash: 'x' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const chr = await db
      .insertInto('characters')
      .values({ account_id: acct.id, name: 'Looter' })
      .returning('id')
      .executeTakeFirstOrThrow();
    characterId = chr.id;
  });

  it('createItem issues a server UUID', async () => {
    const id = await repo.createItem('rusty-sword', null);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('grantItem puts an item in the first free inventory slot', async () => {
    const a = await repo.grantItem(characterId, 'rusty-sword');
    const b = await repo.grantItem(characterId, 'leather-vest');
    expect(a.slot).toBe(0);
    expect(b.slot).toBe(1);
    const inv = await repo.listInventory(characterId);
    expect(inv.map((e) => e.baseId)).toEqual(['rusty-sword', 'leather-vest']);
  });

  it('stashItem picks up an on-ground item and assigns ownership', async () => {
    const groundId = await repo.createItem('copper-ring', null); // owner null
    const slot = await repo.stashItem(characterId, groundId);
    expect(slot).toBe(0);
    const owner = await db
      .selectFrom('items')
      .select('owner_character_id')
      .where('id', '=', groundId)
      .executeTakeFirstOrThrow();
    expect(owner.owner_character_id).toBe(characterId);
  });

  it('equip moves an item from inventory to the gear slot', async () => {
    const { itemId } = await repo.grantItem(characterId, 'rusty-sword');
    const res = await repo.equip(characterId, itemId, 'weapon');
    expect(res).toEqual({ ok: true, unequipped: null });
    expect(await repo.listInventory(characterId)).toEqual([]);
    const eq = await repo.listEquipped(characterId);
    expect(eq).toEqual([{ itemId, baseId: 'rusty-sword', gearSlot: 'weapon' }]);
    expect(await repo.equippedBaseIds(characterId)).toEqual(['rusty-sword']);
  });

  it('equip rejects an item not in the inventory', async () => {
    const orphan = await repo.createItem('rusty-sword', null);
    const res = await repo.equip(characterId, orphan, 'weapon');
    expect(res).toEqual({ ok: false, reason: 'not-in-inventory' });
  });

  it('equipping into an occupied slot swaps the old item back to inventory', async () => {
    const a = await repo.grantItem(characterId, 'rusty-sword');
    const b = await repo.grantItem(characterId, 'apprentice-wand');
    await repo.equip(characterId, a.itemId, 'weapon');
    const res = await repo.equip(characterId, b.itemId, 'weapon');
    expect(res).toEqual({ ok: true, unequipped: a.itemId });
    expect(await repo.equippedBaseIds(characterId)).toEqual(['apprentice-wand']);
    const inv = await repo.listInventory(characterId);
    expect(inv.map((e) => e.itemId)).toEqual([a.itemId]); // old weapon back in bag
  });

  it('unequip returns the item to inventory', async () => {
    const { itemId } = await repo.grantItem(characterId, 'leather-vest');
    await repo.equip(characterId, itemId, 'chest');
    const ok = await repo.unequip(characterId, 'chest');
    expect(ok).toBe(true);
    expect(await repo.listEquipped(characterId)).toEqual([]);
    const inv = await repo.listInventory(characterId);
    expect(inv.map((e) => e.itemId)).toEqual([itemId]);
  });

  it('unequip on an empty slot is a no-op false', async () => {
    expect(await repo.unequip(characterId, 'head')).toBe(false);
  });

  it('two rings can be equipped into ring-1 and ring-2', async () => {
    const r1 = await repo.grantItem(characterId, 'copper-ring');
    const r2 = await repo.grantItem(characterId, 'copper-ring');
    expect((await repo.equip(characterId, r1.itemId, 'ring-1')).ok).toBe(true);
    expect((await repo.equip(characterId, r2.itemId, 'ring-2')).ok).toBe(true);
    expect(await repo.equippedBaseIds(characterId)).toEqual(['copper-ring', 'copper-ring']);
  });
});

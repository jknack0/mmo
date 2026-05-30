import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createDb } from '../db/client.js';
import { env } from '../env.js';
import type { Database } from '../db/types.js';
import { createInventoryRepo, type InventoryRepo } from '../inventory/inventory-repo.js';
import { createAuditRepo, type AuditRepo } from '../audit/audit-repo.js';
import { createVendorService, type VendorService } from './vendor-service.js';
import { vendorEntry, sellValue } from '@mmo/domain';

describe('VendorService', () => {
  let db: Kysely<Database>;
  let repo: InventoryRepo;
  let audit: AuditRepo;
  let svc: VendorService;
  let accountId: string;
  let characterId: string;

  beforeAll(() => {
    db = createDb(env.databaseUrl);
    repo = createInventoryRepo(db);
    audit = createAuditRepo(db);
    svc = createVendorService(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom('audit_log').execute();
    await db.deleteFrom('items').execute();
    await db.deleteFrom('characters').execute();
    await db.deleteFrom('accounts').execute();
    const acct = await db
      .insertInto('accounts')
      .values({ email: 'vendor@example.com', discord_id: null, password_hash: 'x' })
      .returning('id')
      .executeTakeFirstOrThrow();
    accountId = acct.id;
    const chr = await db
      .insertInto('characters')
      .values({ account_id: accountId, name: 'Buyer', gold: 200, materials: 100 })
      .returning('id')
      .executeTakeFirstOrThrow();
    characterId = chr.id;
  });

  const goldOf = async () =>
    (await db.selectFrom('characters').select('gold').where('id', '=', characterId).executeTakeFirstOrThrow()).gold;
  const materialsOf = async () =>
    (await db.selectFrom('characters').select('materials').where('id', '=', characterId).executeTakeFirstOrThrow()).materials;

  it('buying an item deducts gold, adds it to inventory, and writes an audit row', async () => {
    const price = vendorEntry('health-potion')!.price;
    const res = await svc.buy(characterId, accountId, 'health-potion');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.gold).toBe(200 - price);
    expect(await goldOf()).toBe(200 - price);

    const inv = await repo.listInventory(characterId);
    expect(inv.some((i) => i.baseId === 'health-potion')).toBe(true);

    const rows = await audit.list(characterId);
    expect(rows.some((r) => r.action === 'vendor-buy')).toBe(true);
  });

  it('buying a materials bundle tops up materials instead of granting an item', async () => {
    const entry = vendorEntry('tapping-materials')!;
    const res = await svc.buy(characterId, accountId, 'tapping-materials');
    expect(res.ok).toBe(true);
    expect(await materialsOf()).toBe(100 + entry.materialAmount!);
    expect(await goldOf()).toBe(200 - entry.price);
    const inv = await repo.listInventory(characterId);
    expect(inv.length).toBe(0);
  });

  it('rejects a buy when gold is insufficient and changes nothing', async () => {
    await db.updateTable('characters').set({ gold: 5 }).where('id', '=', characterId).execute();
    const res = await svc.buy(characterId, accountId, 'health-potion');
    expect(res).toEqual({ ok: false, reason: 'insufficient-gold' });
    expect(await goldOf()).toBe(5);
    expect((await repo.listInventory(characterId)).length).toBe(0);
    expect((await audit.list(characterId)).length).toBe(0);
  });

  it('rejects an unknown item', async () => {
    const res = await svc.buy(characterId, accountId, 'dragon-egg');
    expect(res).toEqual({ ok: false, reason: 'unknown-item' });
  });

  it('selling an item credits gold, removes it, and writes an audit row', async () => {
    const { itemId } = await repo.grantItem(characterId, 'leather-vest'); // white gear
    const value = sellValue('leather-vest', 0);
    const res = await svc.sell(characterId, accountId, itemId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBe(value);
    expect(await goldOf()).toBe(200 + value);
    expect((await repo.listInventory(characterId)).length).toBe(0);

    const rows = await audit.list(characterId);
    expect(rows.some((r) => r.action === 'vendor-sell')).toBe(true);
  });

  it('rejects selling an item the character does not hold', async () => {
    const res = await svc.sell(characterId, accountId, '00000000-0000-0000-0000-000000000000');
    expect(res).toEqual({ ok: false, reason: 'not-in-inventory' });
    expect(await goldOf()).toBe(200);
  });
});

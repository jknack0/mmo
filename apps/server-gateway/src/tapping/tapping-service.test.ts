import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createDb } from '../db/client.js';
import { env } from '../env.js';
import type { Database } from '../db/types.js';
import { createInventoryRepo, type InventoryRepo } from '../inventory/inventory-repo.js';
import { createTappingService, type TappingService } from './tapping-service.js';
import { PITY_THRESHOLD, TAP_COST } from '@mmo/domain';

describe('TappingService', () => {
  let db: Kysely<Database>;
  let repo: InventoryRepo;
  let svc: TappingService;
  let accountId: string;
  let characterId: string;

  beforeAll(() => {
    db = createDb(env.databaseUrl);
    repo = createInventoryRepo(db);
    svc = createTappingService(db);
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
      .values({ email: 'tap@example.com', discord_id: null, password_hash: 'x' })
      .returning('id')
      .executeTakeFirstOrThrow();
    accountId = acct.id;
    const chr = await db
      .insertInto('characters')
      .values({ account_id: accountId, name: 'Tapper' })
      .returning('id')
      .executeTakeFirstOrThrow();
    characterId = chr.id;
  });

  async function whiteItem(): Promise<string> {
    const { itemId } = await repo.grantItem(characterId, 'leather-vest'); // white, cap 5
    return itemId;
  }
  const materials = () =>
    db.selectFrom('characters').select('materials').where('id', '=', characterId).executeTakeFirstOrThrow();

  it('success raises Refinement and consumes materials', async () => {
    const itemId = await whiteItem();
    const r = await svc.attemptRefinement(itemId, accountId, () => 0);
    expect(r).toMatchObject({ ok: true, outcome: 'success', refinement: 1, pityCounter: 0, materials: 100 - TAP_COST });
    expect((await materials()).materials).toBe(100 - TAP_COST);
  });

  it('failure holds Refinement but still consumes materials and bumps pity', async () => {
    const itemId = await whiteItem();
    await svc.attemptRefinement(itemId, accountId, () => 0); // → +1
    const r = await svc.attemptRefinement(itemId, accountId, () => 0.999); // target +2, fails
    expect(r).toMatchObject({ ok: true, outcome: 'fail', refinement: 1, pityCounter: 1 });
    expect((await materials()).materials).toBe(100 - 2 * TAP_COST);
  });

  it('pity guarantees success after the threshold of consecutive failures', async () => {
    const itemId = await whiteItem();
    // Force fails at +0 → +1 (95% success) with a near-1 roll.
    for (let i = 0; i < PITY_THRESHOLD; i++) {
      const r = await svc.attemptRefinement(itemId, accountId, () => 0.999);
      expect(r.ok && r.outcome).toBe('fail');
    }
    const r = await svc.attemptRefinement(itemId, accountId, () => 0.999); // pity forces it
    expect(r).toMatchObject({ ok: true, outcome: 'success', refinement: 1, pityCounter: 0 });
  });

  it('respects the rarity-tier cap (white = +5)', async () => {
    const itemId = await whiteItem();
    await db.updateTable('items').set({ refinement: 5 }).where('id', '=', itemId).execute();
    const before = (await materials()).materials;
    const r = await svc.attemptRefinement(itemId, accountId, () => 0);
    expect(r).toMatchObject({ ok: true, outcome: 'capped', refinement: 5 });
    expect((await materials()).materials).toBe(before); // capped → no spend
  });

  it('rejects when materials are insufficient', async () => {
    const itemId = await whiteItem();
    await db.updateTable('characters').set({ materials: TAP_COST - 1 }).where('id', '=', characterId).execute();
    const r = await svc.attemptRefinement(itemId, accountId, () => 0);
    expect(r).toEqual({ ok: false, error: 'insufficient-materials' });
  });

  it('rejects a tap from a non-owning account', async () => {
    const itemId = await whiteItem();
    const r = await svc.attemptRefinement(itemId, 'a-different-account-id', () => 0);
    expect(r).toEqual({ ok: false, error: 'not-owner' });
  });

  it('rejects an unknown item', async () => {
    const r = await svc.attemptRefinement('00000000-0000-0000-0000-000000000000', accountId, () => 0);
    expect(r).toEqual({ ok: false, error: 'not-found' });
  });
});

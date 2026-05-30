import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createDb } from '../db/client.js';
import { createRedis, type RedisClient } from '../redis/client.js';
import { env } from '../env.js';
import type { Database } from '../db/types.js';
import { createAccountRepo } from '../auth/account-repo.js';
import { createSessionStore } from '../auth/session-store.js';
import { createPasswordHasher } from '../auth/password-hasher.js';
import { createAuthService } from '../auth/auth-service.js';
import type { DiscordClient } from '../auth/types.js';
import { createCharacterRepo } from '../character/character-repo.js';
import { createCharacterService } from '../character/character-service.js';
import { createInventoryRepo, type InventoryRepo } from '../inventory/inventory-repo.js';
import { createTappingService } from '../tapping/tapping-service.js';
import { createVendorService } from '../vendor/vendor-service.js';
import { buildGatewayServer } from './server.js';
import { vendorEntry } from '@mmo/domain';

const stubDiscord: DiscordClient = {
  exchangeCodeForToken: async () => { throw new Error('unused'); },
  fetchUser: async () => { throw new Error('unused'); },
};

describe('vendor HTTP + AuditLog', () => {
  let db: Kysely<Database>;
  let redis: RedisClient;
  let server: Server;
  let url: string;
  let inventory: InventoryRepo;

  beforeAll(async () => {
    db = createDb(env.databaseUrl);
    redis = createRedis(env.redisUrl);
    inventory = createInventoryRepo(db);
    const auth = createAuthService({
      accountRepo: createAccountRepo(db),
      sessionStore: createSessionStore({ redis, ttlSeconds: 60 }),
      passwordHasher: createPasswordHasher({ rounds: env.bcryptRounds }),
      discordClient: stubDiscord,
      discord: env.discord,
      passwordMinLength: 8,
      redis,
    });
    const characters = createCharacterService({ characterRepo: createCharacterRepo(db) });
    server = buildGatewayServer({
      auth,
      characters,
      redis,
      inventory,
      tapping: createTappingService(db),
      vendor: createVendorService(db),
      clientOrigin: 'http://localhost:5173',
      channelWsUrl: 'ws://channel.test:8081',
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await db.deleteFrom('audit_log').execute();
    await db.deleteFrom('items').execute();
    await db.deleteFrom('characters').execute();
    await db.deleteFrom('accounts').execute();
    await redis.flushdb();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    await db.destroy();
    await redis.quit();
  });

  async function setup(email: string): Promise<{ token: string; characterId: string }> {
    const reg = await fetch(`${url}/auth/email/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password-test-1' }),
    });
    const { sessionToken } = (await reg.json()) as { sessionToken: string };
    const chr = await fetch(`${url}/characters`, {
      method: 'POST',
      headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Shopper' }),
    });
    const { character } = (await chr.json()) as { character: { id: string } };
    return { token: sessionToken, characterId: character.id };
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const authJson = (token: string) => ({ ...auth(token), 'content-type': 'application/json' });

  it('GET /vendor returns the catalog', async () => {
    const res = await fetch(`${url}/vendor`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { catalog: { baseId: string }[] };
    expect(body.catalog.some((e) => e.baseId === 'health-potion')).toBe(true);
  });

  it('GET inventory includes a gold balance', async () => {
    const { token, characterId } = await setup('gold@example.com');
    const res = await fetch(`${url}/characters/${characterId}/inventory`, { headers: auth(token) });
    const body = (await res.json()) as { gold: number };
    expect(body.gold).toBe(100); // default
  });

  it('buy deducts gold, adds the item, and writes an AuditLog row', async () => {
    const { token, characterId } = await setup('buy@example.com');
    const price = vendorEntry('health-potion')!.price;
    const res = await fetch(`${url}/characters/${characterId}/vendor/buy`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ baseId: 'health-potion' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { gold: number; inventory: { baseId: string }[] };
    expect(body.gold).toBe(100 - price);
    expect(body.inventory.some((i) => i.baseId === 'health-potion')).toBe(true);

    // AuditLog integration: a vendor-buy row exists in Postgres for this character.
    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('character_id', '=', characterId)
      .where('action', '=', 'vendor-buy')
      .execute();
    expect(rows.length).toBe(1);
  });

  it('buy with insufficient gold returns 400', async () => {
    const { token, characterId } = await setup('poor@example.com');
    await db.updateTable('characters').set({ gold: 1 }).where('id', '=', characterId).execute();
    const res = await fetch(`${url}/characters/${characterId}/vendor/buy`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ baseId: 'health-potion' }),
    });
    expect(res.status).toBe(400);
  });

  it('sell credits gold, removes the item, and writes an AuditLog row', async () => {
    const { token, characterId } = await setup('sell@example.com');
    const { itemId } = await inventory.grantItem(characterId, 'leather-vest');
    const res = await fetch(`${url}/characters/${characterId}/vendor/sell`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ itemId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { gold: number; value: number; inventory: unknown[] };
    expect(body.gold).toBe(100 + body.value);
    expect(body.inventory).toEqual([]);

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('character_id', '=', characterId)
      .where('action', '=', 'vendor-sell')
      .execute();
    expect(rows.length).toBe(1);
  });

  it('vendor routes 404 when the character belongs to another account', async () => {
    const a = await setup('owner-v@example.com');
    const b = await setup('intruder-v@example.com');
    const res = await fetch(`${url}/characters/${a.characterId}/vendor/buy`, {
      method: 'POST',
      headers: authJson(b.token),
      body: JSON.stringify({ baseId: 'health-potion' }),
    });
    expect(res.status).toBe(404);
  });
});

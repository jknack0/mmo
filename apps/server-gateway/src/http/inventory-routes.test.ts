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
import { buildGatewayServer } from './server.js';

const stubDiscord: DiscordClient = {
  exchangeCodeForToken: async () => { throw new Error('unused'); },
  fetchUser: async () => { throw new Error('unused'); },
};

describe('inventory + equip HTTP', () => {
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
      clientOrigin: 'http://localhost:5173',
      channelWsUrl: 'ws://channel.test:8081',
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
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
      body: JSON.stringify({ name: 'Looter' }),
    });
    const { character } = (await chr.json()) as { character: { id: string } };
    return { token: sessionToken, characterId: character.id };
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const authJson = (token: string) => ({ ...auth(token), 'content-type': 'application/json' });

  it('GET inventory is empty for a fresh character', async () => {
    const { token, characterId } = await setup('a@example.com');
    const res = await fetch(`${url}/characters/${characterId}/inventory`, { headers: auth(token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      inventory: unknown[];
      equipped: unknown[];
      attributes: { str: number; dex: number; int: number; vit: number };
      armor: number;
    };
    expect(body.inventory).toEqual([]);
    expect(body.equipped).toEqual([]);
    expect(body.attributes).toEqual({ str: 0, dex: 0, int: 0, vit: 0 });
    expect(body.armor).toBe(0);
  });

  it('equip moves an item to the gear slot and updates the attribute sheet', async () => {
    const { token, characterId } = await setup('b@example.com');
    const { itemId } = await inventory.grantItem(characterId, 'apprentice-wand'); // int 4
    const equip = await fetch(`${url}/characters/${characterId}/equip`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ itemId, gearSlot: 'weapon' }),
    });
    expect(equip.status).toBe(200);
    const res = await fetch(`${url}/characters/${characterId}/inventory`, { headers: auth(token) });
    const body = (await res.json()) as {
      inventory: { itemId: string }[];
      equipped: { gearSlot: string; baseId: string }[];
      attributes: { int: number };
    };
    expect(body.inventory).toEqual([]);
    expect(body.equipped).toEqual([
      { itemId, baseId: 'apprentice-wand', gearSlot: 'weapon', affixes: [], rarity: 'white', refinement: 0 },
    ]);
    expect(body.attributes.int).toBe(4);
  });

  it('equip rejects an incompatible gear slot', async () => {
    const { token, characterId } = await setup('c@example.com');
    const { itemId } = await inventory.grantItem(characterId, 'apprentice-wand');
    const res = await fetch(`${url}/characters/${characterId}/equip`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ itemId, gearSlot: 'head' }),
    });
    expect(res.status).toBe(400);
  });

  it('unequip returns the item to the inventory', async () => {
    const { token, characterId } = await setup('d@example.com');
    const { itemId } = await inventory.grantItem(characterId, 'leather-vest');
    await fetch(`${url}/characters/${characterId}/equip`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ itemId, gearSlot: 'chest' }),
    });
    const un = await fetch(`${url}/characters/${characterId}/unequip`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ gearSlot: 'chest' }),
    });
    expect(un.status).toBe(200);
    const res = await fetch(`${url}/characters/${characterId}/inventory`, { headers: auth(token) });
    const body = (await res.json()) as { inventory: { itemId: string }[]; equipped: unknown[] };
    expect(body.equipped).toEqual([]);
    expect(body.inventory.map((e) => e.itemId)).toEqual([itemId]);
  });

  it('tap raises Refinement, consumes materials, and reports it via GET', async () => {
    const { token, characterId } = await setup('tap@example.com');
    const { itemId } = await inventory.grantItem(characterId, 'leather-vest'); // white
    const tap = await fetch(`${url}/characters/${characterId}/items/${itemId}/tap`, {
      method: 'POST',
      headers: authJson(token),
    });
    expect(tap.status).toBe(200);
    const body = (await tap.json()) as { outcome: string; refinement: number; materials: number };
    // White +0→+1 has 95% success; with the real RNG this is usually success,
    // but assert only the invariants that always hold.
    expect(['success', 'fail']).toContain(body.outcome);
    expect(body.materials).toBe(90); // a real attempt always spends TAP_COST
    const inv = await fetch(`${url}/characters/${characterId}/inventory`, { headers: auth(token) });
    const view = (await inv.json()) as { materials: number; inventory: { refinement: number }[] };
    expect(view.materials).toBe(90);
    expect(view.inventory[0]!.refinement).toBe(body.outcome === 'success' ? 1 : 0);
  });

  it('tap on another account’s item is rejected', async () => {
    const a = await setup('owner2@example.com');
    const b = await setup('intruder2@example.com');
    const { itemId } = await inventory.grantItem(a.characterId, 'leather-vest');
    // b tries to tap a's item via b's own character route — character 404 first.
    const res = await fetch(`${url}/characters/${b.characterId}/items/${itemId}/tap`, {
      method: 'POST',
      headers: authJson(b.token),
    });
    expect(res.status).toBe(400); // not-owner (item belongs to a)
  });

  it('401 without a token', async () => {
    const res = await fetch(`${url}/characters/00000000-0000-0000-0000-000000000000/inventory`);
    expect(res.status).toBe(401);
  });

  it('404 when the character belongs to another account', async () => {
    const a = await setup('owner@example.com');
    const b = await setup('intruder@example.com');
    const res = await fetch(`${url}/characters/${a.characterId}/inventory`, { headers: auth(b.token) });
    expect(res.status).toBe(404);
  });
});

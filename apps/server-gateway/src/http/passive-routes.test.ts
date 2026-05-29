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
import { buildGatewayServer } from './server.js';

const stubDiscord: DiscordClient = {
  exchangeCodeForToken: async () => { throw new Error('unused'); },
  fetchUser: async () => { throw new Error('unused'); },
};

describe('GET/PUT /characters/:id/passives', () => {
  let db: Kysely<Database>;
  let redis: RedisClient;
  let server: Server;
  let url: string;

  beforeAll(async () => {
    db = createDb(env.databaseUrl);
    redis = createRedis(env.redisUrl);
    const auth = createAuthService({
      accountRepo: createAccountRepo(db),
      sessionStore: createSessionStore({ redis, ttlSeconds: 60 }),
      passwordHasher: createPasswordHasher({ rounds: env.bcryptRounds }),
      discordClient: stubDiscord,
      discord: env.discord,
      passwordMinLength: 8,
      redis,
    });
    const characters = createCharacterService({
      characterRepo: createCharacterRepo(db),
    });
    server = buildGatewayServer({
      auth,
      characters,
      redis,
      clientOrigin: 'http://localhost:5173',
      channelWsUrl: 'ws://channel.test:8081',
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
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
      body: JSON.stringify({ name: 'Pyro' }),
    });
    const { character } = (await chr.json()) as { character: { id: string } };
    return { token: sessionToken, characterId: character.id };
  }

  it('GET returns an empty allocation for a fresh character', async () => {
    const { token, characterId } = await setup('a@example.com');
    const res = await fetch(`${url}/characters/${characterId}/passives`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allocation: Record<string, number> };
    expect(body.allocation).toEqual({});
  });

  it('PUT persists a valid allocation; subsequent GET returns it', async () => {
    const { token, characterId } = await setup('b@example.com');
    const allocation = { 'embered-soul': 1, 'inner-furnace': 1, 'sharpened-flame': 1 };
    const put = await fetch(`${url}/characters/${characterId}/passives`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ allocation }),
    });
    expect(put.status).toBe(200);
    const get = await fetch(`${url}/characters/${characterId}/passives`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await get.json()) as { allocation: typeof allocation };
    expect(body.allocation).toEqual(allocation);
  });

  it('PUT rejects an allocation that violates prerequisite gating', async () => {
    const { token, characterId } = await setup('c@example.com');
    // sharpened-flame without the two roots
    const res = await fetch(`${url}/characters/${characterId}/passives`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ allocation: { 'sharpened-flame': 1 } }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT rejects an unknown node', async () => {
    const { token, characterId } = await setup('d@example.com');
    const res = await fetch(`${url}/characters/${characterId}/passives`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ allocation: { 'made-up-node': 1 } }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    const res = await fetch(`${url}/characters/00000000-0000-0000-0000-000000000000/passives`);
    expect(res.status).toBe(401);
  });

  it('returns 404 when the character belongs to another account', async () => {
    const a = await setup('owner@example.com');
    const b = await setup('other@example.com');
    const res = await fetch(`${url}/characters/${a.characterId}/passives`, {
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(res.status).toBe(404);
  });
});

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

describe('GET/PUT /characters/:id/tripods', () => {
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

  it('GET returns an empty loadout for a fresh character', async () => {
    const { token, characterId } = await setup('a@example.com');
    const res = await fetch(`${url}/characters/${characterId}/tripods`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { loadout: Record<string, unknown> };
    expect(body.loadout).toEqual({});
  });

  it('PUT persists the loadout; subsequent GET returns it', async () => {
    const { token, characterId } = await setup('b@example.com');
    const loadout = { fireball: { t1: 0, t2: 1 }, spark: { t1: 2, t2: 0 } };
    const put = await fetch(`${url}/characters/${characterId}/tripods`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ loadout }),
    });
    expect(put.status).toBe(200);
    const get = await fetch(`${url}/characters/${characterId}/tripods`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await get.json()) as { loadout: typeof loadout };
    expect(body.loadout).toEqual(loadout);
  });

  it('PUT rejects a malformed loadout', async () => {
    const { token, characterId } = await setup('c@example.com');
    const res = await fetch(`${url}/characters/${characterId}/tripods`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ loadout: { fireball: { t1: 99 } } }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    const res = await fetch(`${url}/characters/00000000-0000-0000-0000-000000000000/tripods`);
    expect(res.status).toBe(401);
  });

  it('returns 404 when the character belongs to another account', async () => {
    const a = await setup('owner@example.com');
    const b = await setup('other@example.com');
    const res = await fetch(`${url}/characters/${a.characterId}/tripods`, {
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(res.status).toBe(404);
  });
});

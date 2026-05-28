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

describe('Character HTTP routes', () => {
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
      clientOrigin: 'http://localhost:5173',
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    url = `http://127.0.0.1:${addr.port}`;
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

  async function registerAndAuth(email: string): Promise<{ token: string; accountId: string }> {
    const res = await fetch(`${url}/auth/email/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password-test-1' }),
    });
    const body = (await res.json()) as { sessionToken: string; accountId: string };
    return { token: body.sessionToken, accountId: body.accountId };
  }

  function authHeaders(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  }

  describe('auth gate', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await fetch(`${url}/me`);
      expect(res.status).toBe(401);
    });

    it('returns 401 for an unknown token', async () => {
      const res = await fetch(`${url}/me`, {
        headers: { authorization: 'Bearer never-issued' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /me', () => {
    it('returns the accountId for a valid session', async () => {
      const { token, accountId } = await registerAndAuth('me@example.com');
      const res = await fetch(`${url}/me`, { headers: authHeaders(token) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { accountId: string };
      expect(body.accountId).toBe(accountId);
    });
  });

  describe('GET /characters', () => {
    it('returns empty list for a new account', async () => {
      const { token } = await registerAndAuth('newuser@example.com');
      const res = await fetch(`${url}/characters`, { headers: authHeaders(token) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { characters: unknown[] };
      expect(body.characters).toEqual([]);
    });

    it('lists characters for the authenticated account', async () => {
      const { token } = await registerAndAuth('list@example.com');
      await fetch(`${url}/characters`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ name: 'Eowyn' }),
      });
      const res = await fetch(`${url}/characters`, { headers: authHeaders(token) });
      const body = (await res.json()) as { characters: { name: string }[] };
      expect(body.characters.map((c) => c.name)).toEqual(['Eowyn']);
    });

    it('does not leak characters from other accounts', async () => {
      const a = await registerAndAuth('a@example.com');
      const b = await registerAndAuth('b@example.com');
      await fetch(`${url}/characters`, {
        method: 'POST',
        headers: authHeaders(a.token),
        body: JSON.stringify({ name: 'OnlyA' }),
      });
      const res = await fetch(`${url}/characters`, { headers: authHeaders(b.token) });
      const body = (await res.json()) as { characters: unknown[] };
      expect(body.characters).toEqual([]);
    });
  });

  describe('POST /characters', () => {
    it('creates a character and returns it', async () => {
      const { token } = await registerAndAuth('create@example.com');
      const res = await fetch(`${url}/characters`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ name: 'Galadriel' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { character: { id: string; name: string } };
      expect(body.character.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.character.name).toBe('Galadriel');
    });

    it('returns 409 with name-taken when duplicate', async () => {
      const { token } = await registerAndAuth('dup@example.com');
      await fetch(`${url}/characters`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ name: 'Dup' }),
      });
      const res = await fetch(`${url}/characters`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ name: 'dup' }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('name-taken');
    });

    it('returns 400 with validation error for too-short name', async () => {
      const { token } = await registerAndAuth('short@example.com');
      const res = await fetch(`${url}/characters`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ name: 'X' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('name-too-short');
    });
  });

  describe('POST /characters/:id/play', () => {
    it('returns the character and updates last_login_at', async () => {
      const { token } = await registerAndAuth('play@example.com');
      const create = await fetch(`${url}/characters`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ name: 'PlayChar' }),
      });
      const created = (await create.json()) as { character: { id: string } };

      const res = await fetch(`${url}/characters/${created.character.id}/play`, {
        method: 'POST',
        headers: authHeaders(token),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { character: { lastLoginAt: string | null } };
      expect(body.character.lastLoginAt).not.toBeNull();
    });

    it('returns 404 when the character does not belong to the account', async () => {
      const a = await registerAndAuth('owner@example.com');
      const b = await registerAndAuth('other@example.com');
      const create = await fetch(`${url}/characters`, {
        method: 'POST',
        headers: authHeaders(a.token),
        body: JSON.stringify({ name: 'NotYours' }),
      });
      const created = (await create.json()) as { character: { id: string } };

      const res = await fetch(`${url}/characters/${created.character.id}/play`, {
        method: 'POST',
        headers: authHeaders(b.token),
      });
      expect(res.status).toBe(404);
    });
  });
});

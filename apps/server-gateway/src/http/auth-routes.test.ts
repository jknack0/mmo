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
import type { DiscordClient, DiscordUser } from '../auth/types.js';
import { createCharacterRepo } from '../character/character-repo.js';
import { createCharacterService } from '../character/character-service.js';
import { buildGatewayServer } from './server.js';

function makeDiscordClient(user: DiscordUser): DiscordClient {
  return {
    async exchangeCodeForToken(code) {
      return { accessToken: `token-${code}` };
    },
    async fetchUser() {
      return user;
    },
  };
}

describe('Auth HTTP routes', () => {
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
      discordClient: makeDiscordClient({ id: 'd-http', username: 'd-http' }),
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
      channelWsUrl: 'ws://channel.test:8081',
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    url = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(async () => {
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

  describe('POST /auth/email/register', () => {
    it('returns 200 with session token on valid registration', async () => {
      const res = await fetch(`${url}/auth/email/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'register@example.com',
          password: 'password-good',
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sessionToken: string; accountId: string };
      expect(body.sessionToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
      expect(body.accountId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('returns 400 with error on duplicate email', async () => {
      await fetch(`${url}/auth/email/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'dup@example.com', password: 'password-good' }),
      });
      const res = await fetch(`${url}/auth/email/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'dup@example.com', password: 'password-good' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('email-already-exists');
    });

    it('returns 400 on weak password', async () => {
      const res = await fetch(`${url}/auth/email/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'weak@example.com', password: 'short' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/email/login', () => {
    beforeEach(async () => {
      await fetch(`${url}/auth/email/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'login@example.com', password: 'password-good' }),
      });
    });

    it('returns 200 with session on valid credentials', async () => {
      const res = await fetch(`${url}/auth/email/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'login@example.com', password: 'password-good' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sessionToken: string };
      expect(body.sessionToken).toBeTruthy();
    });

    it('returns 401 on wrong password', async () => {
      const res = await fetch(`${url}/auth/email/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'login@example.com', password: 'wrong-password' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /auth/discord/start', () => {
    it('302 redirects to Discord with a state param', async () => {
      const res = await fetch(`${url}/auth/discord/start`, { redirect: 'manual' });
      expect(res.status).toBe(302);
      const location = res.headers.get('location');
      expect(location).toMatch(/^https:\/\/discord\.com\/api\/oauth2\/authorize/);
      expect(location).toMatch(/state=/);
    });
  });

  describe('GET /auth/discord/callback', () => {
    it('302 redirects to client with session token in URL when code+state valid', async () => {
      // First call /start to get a valid state stored in Redis.
      const startRes = await fetch(`${url}/auth/discord/start`, { redirect: 'manual' });
      const startLocation = startRes.headers.get('location')!;
      const state = new URL(startLocation).searchParams.get('state')!;

      const cbRes = await fetch(
        `${url}/auth/discord/callback?code=ok-code&state=${encodeURIComponent(state)}`,
        { redirect: 'manual' }
      );
      expect(cbRes.status).toBe(302);
      const location = cbRes.headers.get('location')!;
      expect(location).toMatch(/^http:\/\/localhost:5173/);
      expect(location).toMatch(/session=/);
    });

    it('302 redirects to client with error param when state invalid', async () => {
      const res = await fetch(
        `${url}/auth/discord/callback?code=anything&state=never-issued`,
        { redirect: 'manual' }
      );
      expect(res.status).toBe(302);
      const location = res.headers.get('location')!;
      expect(location).toMatch(/error=discord-state-invalid/);
    });
  });
});

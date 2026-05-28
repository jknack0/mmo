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

const CHANNEL_WS_URL = 'ws://channel.test.local:8081';

describe('POST /connect', () => {
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
    server = buildGatewayServer({ redis,
      auth,
      characters,
      clientOrigin: 'http://localhost:5173',
      channelWsUrl: CHANNEL_WS_URL,
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

  async function registerAndCreateChar(email: string, name: string): Promise<{
    token: string;
    accountId: string;
    characterId: string;
  }> {
    const reg = await fetch(`${url}/auth/email/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password-test-1' }),
    });
    const { sessionToken, accountId } = (await reg.json()) as {
      sessionToken: string;
      accountId: string;
    };
    const charRes = await fetch(`${url}/characters`, {
      method: 'POST',
      headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const { character } = (await charRes.json()) as { character: { id: string } };
    return { token: sessionToken, accountId, characterId: character.id };
  }

  it('returns 401 when no Authorization header is present', async () => {
    const res = await fetch(`${url}/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ characterId: 'whatever' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 when the character does not exist', async () => {
    const reg = await fetch(`${url}/auth/email/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'password-test-1' }),
    });
    const { sessionToken } = (await reg.json()) as { sessionToken: string };
    const res = await fetch(`${url}/connect`, {
      method: 'POST',
      headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ characterId: '00000000-0000-0000-0000-000000000000' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when the character belongs to a different account', async () => {
    const a = await registerAndCreateChar('a@example.com', 'Anya');
    const b = await registerAndCreateChar('b@example.com', 'Bran');
    const res = await fetch(`${url}/connect`, {
      method: 'POST',
      headers: { authorization: `Bearer ${b.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ characterId: a.characterId }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 with wsUrl + channelId + character for a valid request', async () => {
    const a = await registerAndCreateChar('valid@example.com', 'Valid');
    const res = await fetch(`${url}/connect`, {
      method: 'POST',
      headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ characterId: a.characterId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      wsUrl: string;
      channelId: string;
      character: { id: string; name: string };
    };
    expect(body.wsUrl).toBe(CHANNEL_WS_URL);
    expect(body.channelId).toMatch(/.+/);
    expect(body.character).toEqual({ id: a.characterId, name: 'Valid' });
  });
});

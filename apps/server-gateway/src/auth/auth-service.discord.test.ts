import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { Kysely } from 'kysely';
import { createDb } from '../db/client.js';
import { createRedis, type RedisClient } from '../redis/client.js';
import { env } from '../env.js';
import type { Database } from '../db/types.js';
import { createAccountRepo } from './account-repo.js';
import { createSessionStore } from './session-store.js';
import { createPasswordHasher } from './password-hasher.js';
import { createAuthService } from './auth-service.js';
import type { DiscordClient, DiscordUser } from './types.js';

function makeMockDiscordClient(user: DiscordUser): {
  client: DiscordClient;
  exchangeCalls: { code: string }[];
  fetchCalls: { accessToken: string }[];
} {
  const exchangeCalls: { code: string }[] = [];
  const fetchCalls: { accessToken: string }[] = [];
  return {
    client: {
      async exchangeCodeForToken(code) {
        exchangeCalls.push({ code });
        return { accessToken: `token-for-${code}` };
      },
      async fetchUser(accessToken) {
        fetchCalls.push({ accessToken });
        return user;
      },
    },
    exchangeCalls,
    fetchCalls,
  };
}

describe('AuthService — discord-code flow', () => {
  let db: Kysely<Database>;
  let redis: RedisClient;

  beforeAll(() => {
    db = createDb(env.databaseUrl);
    redis = createRedis(env.redisUrl);
  });

  beforeEach(async () => {
    await db.deleteFrom('accounts').execute();
    await redis.flushdb();
  });

  afterAll(async () => {
    await db.destroy();
    await redis.quit();
  });

  function buildAuth(discordClient: DiscordClient) {
    return createAuthService({
      accountRepo: createAccountRepo(db),
      sessionStore: createSessionStore({ redis, ttlSeconds: 60 }),
      passwordHasher: createPasswordHasher({ rounds: env.bcryptRounds }),
      discordClient,
      discord: env.discord,
      passwordMinLength: 8,
      redis,
    });
  }

  it('generateDiscordOAuthStart returns a Discord URL with the state stored in Redis', async () => {
    const auth = buildAuth(makeMockDiscordClient({ id: 'd1', username: 'd1' }).client);
    const { url, state } = await auth.generateDiscordOAuthStart();
    expect(url).toContain('https://discord.com/api/oauth2/authorize');
    expect(url).toContain(`state=${state}`);
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=identify');
    expect(await redis.get(`oauth-state:${state}`)).not.toBeNull();
  });

  it('happy path: valid code+state creates a new account and issues a session', async () => {
    const mock = makeMockDiscordClient({ id: 'discord-user-1', username: 'CoolName' });
    const auth = buildAuth(mock.client);
    const { state } = await auth.generateDiscordOAuthStart();

    const result = await auth.authenticate({
      kind: 'discord-code',
      code: 'auth-code-abc',
      state,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accountId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(mock.exchangeCalls).toEqual([{ code: 'auth-code-abc' }]);
    expect(mock.fetchCalls).toEqual([{ accessToken: 'token-for-auth-code-abc' }]);

    const accountRepo = createAccountRepo(db);
    const found = await accountRepo.findByDiscordId('discord-user-1');
    expect(found?.id).toBe(result.accountId);
  });

  it('reuses an existing account when discord_id already exists', async () => {
    const mock = makeMockDiscordClient({ id: 'returning-user', username: 'Returning' });
    const auth = buildAuth(mock.client);
    const accountRepo = createAccountRepo(db);
    const pre = await accountRepo.create({ discordId: 'returning-user' });

    const { state } = await auth.generateDiscordOAuthStart();
    const result = await auth.authenticate({
      kind: 'discord-code',
      code: 'auth-code-xyz',
      state,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accountId).toBe(pre.id);
  });

  it('rejects an invalid (unknown) state', async () => {
    const auth = buildAuth(makeMockDiscordClient({ id: 'x', username: 'x' }).client);
    const result = await auth.authenticate({
      kind: 'discord-code',
      code: 'whatever',
      state: 'never-issued',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('discord-state-invalid');
  });

  it('consumes the state on use (replay attempts fail)', async () => {
    const auth = buildAuth(makeMockDiscordClient({ id: 'd2', username: 'd2' }).client);
    const { state } = await auth.generateDiscordOAuthStart();
    const first = await auth.authenticate({ kind: 'discord-code', code: 'c1', state });
    expect(first.ok).toBe(true);
    const replay = await auth.authenticate({ kind: 'discord-code', code: 'c2', state });
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.error).toBe('discord-state-invalid');
  });

  it('returns discord-exchange-failed if the Discord client throws on exchange', async () => {
    const failing: DiscordClient = {
      exchangeCodeForToken: vi.fn(async () => {
        throw new Error('upstream 500');
      }),
      fetchUser: vi.fn(),
    };
    const auth = buildAuth(failing);
    const { state } = await auth.generateDiscordOAuthStart();
    const result = await auth.authenticate({
      kind: 'discord-code',
      code: 'any',
      state,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('discord-exchange-failed');
  });
});

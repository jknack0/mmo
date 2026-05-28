import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createDb } from '../db/client.js';
import { createRedis, type RedisClient } from '../redis/client.js';
import { env } from '../env.js';
import type { Database } from '../db/types.js';
import { createAccountRepo } from './account-repo.js';
import { createSessionStore } from './session-store.js';
import { createPasswordHasher } from './password-hasher.js';
import { createAuthService } from './auth-service.js';
import type { DiscordClient } from './types.js';

const stubDiscord: DiscordClient = {
  exchangeCodeForToken: async () => { throw new Error('unused'); },
  fetchUser: async () => { throw new Error('unused'); },
};

describe('AuthService — session lifecycle', () => {
  let db: Kysely<Database>;
  let redis: RedisClient;
  let auth: ReturnType<typeof createAuthService>;

  beforeAll(() => {
    db = createDb(env.databaseUrl);
    redis = createRedis(env.redisUrl);
    auth = createAuthService({
      accountRepo: createAccountRepo(db),
      sessionStore: createSessionStore({ redis, ttlSeconds: 60 }),
      passwordHasher: createPasswordHasher({ rounds: env.bcryptRounds }),
      discordClient: stubDiscord,
      discord: env.discord,
      passwordMinLength: 8,
      redis,
    });
  });

  beforeEach(async () => {
    await db.deleteFrom('accounts').execute();
    await redis.flushdb();
  });

  afterAll(async () => {
    await db.destroy();
    await redis.quit();
  });

  it('validateSession returns the accountId for a freshly issued token', async () => {
    const result = await auth.authenticate({
      kind: 'email-register',
      email: 'lifecycle@example.com',
      password: 'password-of-life',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = await auth.validateSession(result.sessionToken);
    expect(session?.accountId).toBe(result.accountId);
  });

  it('validateSession returns null for unknown tokens', async () => {
    expect(await auth.validateSession('never-issued')).toBeNull();
  });

  it('revokeSession invalidates the token (subsequent validate returns null)', async () => {
    const result = await auth.authenticate({
      kind: 'email-register',
      email: 'logout@example.com',
      password: 'password-logout',
    });
    if (!result.ok) throw new Error('precondition failed');
    await auth.revokeSession(result.sessionToken);
    expect(await auth.validateSession(result.sessionToken)).toBeNull();
  });
});

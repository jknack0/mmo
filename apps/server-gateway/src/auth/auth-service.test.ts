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

function stubDiscordClient(): DiscordClient {
  return {
    async exchangeCodeForToken() {
      throw new Error('stub: discord not used in email tests');
    },
    async fetchUser() {
      throw new Error('stub: discord not used in email tests');
    },
  };
}

describe('AuthService — email flow', () => {
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
      discordClient: stubDiscordClient(),
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

  describe('email-register', () => {
    it('creates an account and issues a session for a valid registration', async () => {
      const result = await auth.authenticate({
        kind: 'email-register',
        email: 'alice@example.com',
        password: 'correct horse battery staple',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
      expect(result.accountId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('persists the registered account so subsequent login finds it', async () => {
      await auth.authenticate({
        kind: 'email-register',
        email: 'bob@example.com',
        password: 'right-password-1',
      });
      const login = await auth.authenticate({
        kind: 'email-login',
        email: 'bob@example.com',
        password: 'right-password-1',
      });
      expect(login.ok).toBe(true);
    });

    it('rejects a duplicate email registration', async () => {
      await auth.authenticate({
        kind: 'email-register',
        email: 'dup@example.com',
        password: 'first-password-1',
      });
      const second = await auth.authenticate({
        kind: 'email-register',
        email: 'dup@example.com',
        password: 'second-password-1',
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error).toBe('email-already-exists');
    });

    it('rejects a weak password', async () => {
      const result = await auth.authenticate({
        kind: 'email-register',
        email: 'weak@example.com',
        password: 'short',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('weak-password');
    });
  });

  describe('email-login', () => {
    beforeEach(async () => {
      await auth.authenticate({
        kind: 'email-register',
        email: 'login-user@example.com',
        password: 'correct-password-1',
      });
    });

    it('issues a session for valid credentials', async () => {
      const result = await auth.authenticate({
        kind: 'email-login',
        email: 'login-user@example.com',
        password: 'correct-password-1',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects a wrong password', async () => {
      const result = await auth.authenticate({
        kind: 'email-login',
        email: 'login-user@example.com',
        password: 'wrong-password-2',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('invalid-credentials');
    });

    it('rejects an unknown email', async () => {
      const result = await auth.authenticate({
        kind: 'email-login',
        email: 'unknown@example.com',
        password: 'correct-password-1',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('invalid-credentials');
    });
  });
});

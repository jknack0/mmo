import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createRedis, type RedisClient } from '../redis/client.js';
import { env } from '../env.js';
import { createSessionStore } from './session-store.js';

describe('SessionStore', () => {
  let redis: RedisClient;
  let store: ReturnType<typeof createSessionStore>;

  beforeAll(() => {
    redis = createRedis(env.redisUrl);
    store = createSessionStore({ redis, ttlSeconds: 60 });
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('issues a token that can be validated back to the account', async () => {
    const token = await store.issue('account-abc');
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const session = await store.validate(token);
    expect(session?.accountId).toBe('account-abc');
  });

  it('returns null when validating an unknown token', async () => {
    expect(await store.validate('does-not-exist')).toBeNull();
  });

  it('returns null after revoke', async () => {
    const token = await store.issue('account-xyz');
    await store.revoke(token);
    expect(await store.validate(token)).toBeNull();
  });

  it('sets an expiry on issued tokens (TTL > 0)', async () => {
    const token = await store.issue('account-ttl');
    const ttl = await redis.ttl(`session:${token}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('issues distinct tokens across calls', async () => {
    const a = await store.issue('same-acct');
    const b = await store.issue('same-acct');
    expect(a).not.toBe(b);
  });
});

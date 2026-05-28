import { randomBytes } from 'node:crypto';
import type { RedisClient } from '../redis/client.js';

export interface Session {
  accountId: string;
}

export interface SessionStore {
  issue(accountId: string): Promise<string>;
  validate(token: string): Promise<Session | null>;
  revoke(token: string): Promise<void>;
}

export interface SessionStoreOptions {
  redis: RedisClient;
  ttlSeconds: number;
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function sessionKey(token: string): string {
  return `session:${token}`;
}

export function createSessionStore(opts: SessionStoreOptions): SessionStore {
  const { redis, ttlSeconds } = opts;

  return {
    async issue(accountId) {
      const token = generateToken();
      await redis.set(sessionKey(token), accountId, 'EX', ttlSeconds);
      return token;
    },

    async validate(token) {
      const accountId = await redis.get(sessionKey(token));
      return accountId ? { accountId } : null;
    },

    async revoke(token) {
      await redis.del(sessionKey(token));
    },
  };
}

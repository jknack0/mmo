import { config as loadDotenv } from 'dotenv';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env lives at the monorepo root.
loadDotenv({ path: path.resolve(__dirname, '../../../.env') });

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function intOr(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`Env var ${name} must be a number, got: ${v}`);
  }
  return n;
}

const isTest = process.env.NODE_ENV === 'test';

export const env = {
  databaseUrl: isTest
    ? required('TEST_DATABASE_URL')
    : required('DATABASE_URL'),
  redisUrl: isTest ? required('TEST_REDIS_URL') : required('REDIS_URL'),
  gatewayPort: intOr('GATEWAY_PORT', 8080),
  sessionTtlSeconds: intOr('SESSION_TTL_SECONDS', 30 * 24 * 60 * 60),
  bcryptRounds: intOr('BCRYPT_ROUNDS', isTest ? 4 : 12),
  discord: {
    clientId: optional('DISCORD_CLIENT_ID', ''),
    clientSecret: optional('DISCORD_CLIENT_SECRET', ''),
    redirectUrl: optional(
      'DISCORD_REDIRECT_URL',
      'http://localhost:8080/auth/discord/callback'
    ),
  },
};

// Gateway bootstrap. Wires the deep modules and starts the HTTP listener.
// Implements S01 (#3): auth endpoints. Channel routing comes in S04 (#6).

import { env } from './env.js';
import { createDb } from './db/client.js';
import { createRedis } from './redis/client.js';
import { createAccountRepo } from './auth/account-repo.js';
import { createSessionStore } from './auth/session-store.js';
import { createPasswordHasher } from './auth/password-hasher.js';
import { createDiscordClient } from './auth/discord-client.js';
import { createAuthService } from './auth/auth-service.js';
import { createCharacterRepo } from './character/character-repo.js';
import { createCharacterService } from './character/character-service.js';
import { createInventoryRepo } from './inventory/inventory-repo.js';
import { buildGatewayServer } from './http/server.js';

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
const CHANNEL_WS_URL = process.env.CHANNEL_WS_URL ?? 'ws://localhost:8081';

async function main(): Promise<void> {
  const db = createDb(env.databaseUrl);
  const redis = createRedis(env.redisUrl);

  const auth = createAuthService({
    accountRepo: createAccountRepo(db),
    sessionStore: createSessionStore({ redis, ttlSeconds: env.sessionTtlSeconds }),
    passwordHasher: createPasswordHasher({ rounds: env.bcryptRounds }),
    discordClient: createDiscordClient({
      clientId: env.discord.clientId,
      clientSecret: env.discord.clientSecret,
      redirectUrl: env.discord.redirectUrl,
    }),
    discord: env.discord,
    passwordMinLength: 8,
    redis,
  });

  const characters = createCharacterService({
    characterRepo: createCharacterRepo(db),
  });

  const inventory = createInventoryRepo(db);

  const server = buildGatewayServer({
    auth,
    characters,
    redis,
    inventory,
    clientOrigin: CLIENT_ORIGIN,
    channelWsUrl: CHANNEL_WS_URL,
  });
  server.listen(env.gatewayPort, () => {
    console.log(`[gateway] listening on http://localhost:${env.gatewayPort}`);
    console.log(`[gateway] client origin: ${CLIENT_ORIGIN}`);
    if (!env.discord.clientId || !env.discord.clientSecret) {
      console.warn(
        '[gateway] Discord OAuth not configured — set DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET in .env to enable.'
      );
    }
  });

  // Clean shutdown.
  const shutdown = async () => {
    console.log('[gateway] shutting down…');
    server.close();
    await redis.quit();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[gateway] fatal:', err);
  process.exit(1);
});

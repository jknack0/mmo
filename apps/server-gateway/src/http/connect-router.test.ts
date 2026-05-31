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
import { createInventoryRepo } from '../inventory/inventory-repo.js';
import { createTappingService } from '../tapping/tapping-service.js';
import { createVendorService } from '../vendor/vendor-service.js';
import { createChannelRouter, type ChannelRouter } from '../channel-router/channel-router.js';
import { buildGatewayServer } from './server.js';

const stubDiscord: DiscordClient = {
  exchangeCodeForToken: async () => { throw new Error('unused'); },
  fetchUser: async () => { throw new Error('unused'); },
};

describe('POST /connect via ChannelRouter (S04)', () => {
  let db: Kysely<Database>;
  let redis: RedisClient;
  let router: ChannelRouter;
  let server: Server;
  let url: string;

  beforeAll(async () => {
    db = createDb(env.databaseUrl);
    redis = createRedis(env.redisUrl);
    router = createChannelRouter(redis);
    const auth = createAuthService({
      accountRepo: createAccountRepo(db),
      sessionStore: createSessionStore({ redis, ttlSeconds: 60 }),
      passwordHasher: createPasswordHasher({ rounds: env.bcryptRounds }),
      discordClient: stubDiscord,
      discord: env.discord,
      passwordMinLength: 8,
      redis,
    });
    server = buildGatewayServer({
      auth,
      characters: createCharacterService({ characterRepo: createCharacterRepo(db) }),
      redis,
      inventory: createInventoryRepo(db),
      tapping: createTappingService(db),
      vendor: createVendorService(db),
      router,
      clientOrigin: 'http://localhost:5173',
      channelWsUrl: 'ws://unused',
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
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    await db.destroy();
    await redis.quit();
  });

  async function setup(email: string): Promise<{ token: string; characterId: string }> {
    const reg = await fetch(`${url}/auth/email/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password-test-1' }),
    });
    const { sessionToken } = (await reg.json()) as { sessionToken: string };
    const chr = await fetch(`${url}/characters`, {
      method: 'POST',
      headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Wanderer' }),
    });
    const { character } = (await chr.json()) as { character: { id: string } };
    return { token: sessionToken, characterId: character.id };
  }
  const connect = (token: string, payload: object) =>
    fetch(`${url}/connect`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

  it('routes to a registered channel for the requested zone', async () => {
    await router.registerChannel({ channelId: 'ch0', zoneId: 'ashen-plains', processUrl: 'ws://h/ch0', currentLoad: 0 });
    const a = await setup('r1@example.com');
    const res = await connect(a.token, { characterId: a.characterId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { wsUrl: string; channelId: string; zoneId: string };
    expect(body).toMatchObject({ wsUrl: 'ws://h/ch0', channelId: 'ch0', zoneId: 'ashen-plains' });
  });

  it('returns 503 at-capacity when no channel exists and none can spawn', async () => {
    const a = await setup('r2@example.com');
    const res = await connect(a.token, { characterId: a.characterId });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('at-capacity');
  });

  it('honours a manual channel-switch request', async () => {
    await router.registerChannel({ channelId: 'ch0', zoneId: 'hold-veridian', processUrl: 'ws://h/ch0', currentLoad: 5 });
    await router.registerChannel({ channelId: 'ch1', zoneId: 'hold-veridian', processUrl: 'ws://h/ch1', currentLoad: 1 });
    const a = await setup('r3@example.com');
    const res = await connect(a.token, { characterId: a.characterId, zoneId: 'hold-veridian', channelId: 'ch0' });
    const body = (await res.json()) as { channelId: string };
    expect(body.channelId).toBe('ch0'); // got the channel we asked for, not the least-loaded
  });

  it('returns 409 when the manually requested channel is full', async () => {
    await router.registerChannel({ channelId: 'full', zoneId: 'ashen-plains', processUrl: 'ws://h/full', currentLoad: 50 });
    const a = await setup('r4@example.com');
    const res = await connect(a.token, { characterId: a.characterId, channelId: 'full' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('preferred-full');
  });
});

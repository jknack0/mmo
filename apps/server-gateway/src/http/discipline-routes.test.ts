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
import { createAuditRepo } from '../audit/audit-repo.js';
import { buildGatewayServer } from './server.js';
import { PYROMANCY, BLADEMASTER, DISCIPLINE_SWITCH_COST } from '@mmo/domain';

const stub: DiscordClient = {
  exchangeCodeForToken: async () => { throw new Error('unused'); },
  fetchUser: async () => { throw new Error('unused'); },
};

describe('GET/PUT /characters/:id/disciplines (S11)', () => {
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
      discordClient: stub,
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
      audit: createAuditRepo(db),
      clientOrigin: 'http://localhost:5173',
      channelWsUrl: 'ws://x',
    });
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    await db.deleteFrom('characters').execute();
    await db.deleteFrom('accounts').execute();
    await redis.flushdb();
  });
  afterAll(async () => {
    await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
    await db.destroy();
    await redis.quit();
  });

  async function setup(email: string) {
    const reg = await fetch(`${url}/auth/email/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password-test-1' }),
    });
    const { sessionToken } = (await reg.json()) as { sessionToken: string };
    const chr = await fetch(`${url}/characters`, {
      method: 'POST', headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mixer' }),
    });
    const { character } = (await chr.json()) as { character: { id: string } };
    return { token: sessionToken, characterId: character.id };
  }
  const authH = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  it('GET defaults to Pyromancy only', async () => {
    const { token, characterId } = await setup('d1@e.com');
    const res = await fetch(`${url}/characters/${characterId}/disciplines`, { headers: authH(token) });
    expect((await res.json()).equipped).toEqual([PYROMANCY]);
  });

  it('PUT equips two disciplines, charges gold, clears passives, audits', async () => {
    const { token, characterId } = await setup('d2@e.com');
    // Seed a passive allocation first to prove it gets cleared.
    await fetch(`${url}/characters/${characterId}/passives`, {
      method: 'PUT', headers: authH(token), body: JSON.stringify({ allocation: { 'embered-soul': 1 } }),
    });
    const res = await fetch(`${url}/characters/${characterId}/disciplines`, {
      method: 'PUT', headers: authH(token), body: JSON.stringify({ equipped: [PYROMANCY, BLADEMASTER] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { equipped: string[]; gold: number };
    expect(body.equipped).toEqual([PYROMANCY, BLADEMASTER]);
    expect(body.gold).toBe(100 - DISCIPLINE_SWITCH_COST);

    const passives = await (await fetch(`${url}/characters/${characterId}/passives`, { headers: authH(token) })).json();
    expect(passives.allocation).toEqual({}); // cleared per ADR-0004

    const rows = await db.selectFrom('audit_log').selectAll().where('character_id', '=', characterId).where('action', '=', 'discipline-set').execute();
    expect(rows).toHaveLength(1);
  });

  it('PUT rejects more than two disciplines', async () => {
    const { token, characterId } = await setup('d3@e.com');
    const res = await fetch(`${url}/characters/${characterId}/disciplines`, {
      method: 'PUT', headers: authH(token), body: JSON.stringify({ equipped: [PYROMANCY, BLADEMASTER, 'necromancer'] }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT fails with insufficient gold and changes nothing', async () => {
    const { token, characterId } = await setup('d4@e.com');
    await db.updateTable('characters').set({ gold: 5 }).where('id', '=', characterId).execute();
    const res = await fetch(`${url}/characters/${characterId}/disciplines`, {
      method: 'PUT', headers: authH(token), body: JSON.stringify({ equipped: [PYROMANCY, BLADEMASTER] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('insufficient-gold');
  });
});

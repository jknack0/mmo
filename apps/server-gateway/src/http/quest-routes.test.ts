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
import { createQuestRepo } from '../quest/quest-repo.js';
import { buildGatewayServer } from './server.js';
import { PYROMANCY, BLADEMASTER, BLADE_QUEST_ID } from '@mmo/domain';

const stub: DiscordClient = {
  exchangeCodeForToken: async () => { throw new Error('unused'); },
  fetchUser: async () => { throw new Error('unused'); },
};

const EMAIL_DOMAIN = 'quest-routes.test';

describe('Trainer quest routes + learned-equip gate (S12)', () => {
  let db: Kysely<Database>;
  let redis: RedisClient;
  let server: Server;
  let url: string;
  let n = 0;

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
      quests: createQuestRepo(db),
      clientOrigin: 'http://localhost:5173',
      channelWsUrl: 'ws://x',
    });
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    // Scope teardown to this suite's accounts (cascades quests/learned/characters).
    await db.deleteFrom('characters').where('account_id', 'in',
      db.selectFrom('accounts').select('id').where('email', 'like', `%@${EMAIL_DOMAIN}`)).execute();
    await db.deleteFrom('accounts').where('email', 'like', `%@${EMAIL_DOMAIN}`).execute();
  });

  afterAll(async () => {
    await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
    await db.destroy();
    await redis.quit();
  });

  const authH = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  async function setup() {
    const email = `u${n++}@${EMAIL_DOMAIN}`;
    const reg = await fetch(`${url}/auth/email/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password-test-1' }),
    });
    const { sessionToken } = (await reg.json()) as { sessionToken: string };
    const chr = await fetch(`${url}/characters`, {
      method: 'POST', headers: authH(sessionToken),
      body: JSON.stringify({ name: 'Apprentice' }),
    });
    const { character } = (await chr.json()) as { character: { id: string } };
    return { token: sessionToken, characterId: character.id };
  }

  const post = (token: string, path: string) =>
    fetch(`${url}${path}`, { method: 'POST', headers: authH(token) });

  it('GET /quests lists both trainer quests as NotStarted, Pyromancy pre-learned', async () => {
    const { token, characterId } = await setup();
    const res = await fetch(`${url}/characters/${characterId}/quests`, { headers: authH(token) });
    const body = (await res.json()) as { quests: Array<{ id: string; state: string; killTarget: number }>; learned: string[] };
    expect(body.quests).toHaveLength(2);
    expect(body.quests.every((q) => q.state === 'NotStarted' && q.killTarget === 3)).toBe(true);
    expect(body.learned).toEqual([PYROMANCY]);
  });

  it('start → kill ×3 → turn-in unlocks the discipline and is audited', async () => {
    const { token, characterId } = await setup();
    const base = `/characters/${characterId}/quests/${BLADE_QUEST_ID}`;

    expect((await post(token, `${base}/start`)).status).toBe(200);

    let last: { state: string; kills: number } = { state: '', kills: 0 };
    for (let i = 0; i < 3; i++) last = (await (await post(token, `${base}/kill`)).json()) as typeof last;
    expect(last).toMatchObject({ state: 'ReadyToTurnIn', kills: 3 });

    const turn = await post(token, `${base}/turn-in`);
    expect(turn.status).toBe(200);
    expect((await turn.json())).toMatchObject({ state: 'Completed', learned: BLADEMASTER });

    const log = await (await fetch(`${url}/characters/${characterId}/quests`, { headers: authH(token) })).json();
    expect(log.learned.sort()).toEqual([BLADEMASTER, PYROMANCY].sort());

    const audits = await db.selectFrom('audit_log').selectAll()
      .where('character_id', '=', characterId).where('action', '=', 'quest-complete').execute();
    expect(audits).toHaveLength(1);
  });

  it('turn-in before the kills are done is rejected (FSM gate)', async () => {
    const { token, characterId } = await setup();
    const base = `/characters/${characterId}/quests/${BLADE_QUEST_ID}`;
    await post(token, `${base}/start`);
    await post(token, `${base}/kill`); // only 1/3
    const turn = await post(token, `${base}/turn-in`);
    expect(turn.status).toBe(409);
    expect((await turn.json()).error).toBe('not-ready');
  });

  it('starting an already-started quest is rejected', async () => {
    const { token, characterId } = await setup();
    const base = `/characters/${characterId}/quests/${BLADE_QUEST_ID}`;
    expect((await post(token, `${base}/start`)).status).toBe(200);
    expect((await post(token, `${base}/start`)).status).toBe(409);
  });

  it('PUT /disciplines rejects equipping an unlearned discipline (Blademaster)', async () => {
    const { token, characterId } = await setup();
    const res = await fetch(`${url}/characters/${characterId}/disciplines`, {
      method: 'PUT', headers: authH(token), body: JSON.stringify({ equipped: [PYROMANCY, BLADEMASTER] }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('discipline-not-learned');
  });

  it('after completing the Blademaster quest, equipping it succeeds', async () => {
    const { token, characterId } = await setup();
    const base = `/characters/${characterId}/quests/${BLADE_QUEST_ID}`;
    await post(token, `${base}/start`);
    for (let i = 0; i < 3; i++) await post(token, `${base}/kill`);
    await post(token, `${base}/turn-in`);

    const res = await fetch(`${url}/characters/${characterId}/disciplines`, {
      method: 'PUT', headers: authH(token), body: JSON.stringify({ equipped: [PYROMANCY, BLADEMASTER] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).equipped).toEqual([PYROMANCY, BLADEMASTER]);
  });

  it('unknown quest id 404s', async () => {
    const { token, characterId } = await setup();
    const res = await post(token, `/characters/${characterId}/quests/learn-necromancy/start`);
    expect(res.status).toBe(404);
  });
});

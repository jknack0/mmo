import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createDb } from '../db/client.js';
import { env } from '../env.js';
import type { Database } from '../db/types.js';
import { createQuestRepo, type QuestRepo } from './quest-repo.js';
import { PYRO_QUEST_ID, BLADE_QUEST_ID, PYROMANCY, BLADEMASTER } from '@mmo/domain';

const EMAIL = 'quest-repo@example.com';

describe('QuestRepo', () => {
  let db: Kysely<Database>;
  let repo: QuestRepo;
  let characterId: string;

  beforeAll(() => {
    db = createDb(env.databaseUrl);
    repo = createQuestRepo(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    // Scope teardown to our own account so we don't race sibling suites on the
    // shared mmo_test DB. Quest/learned rows cascade on character delete.
    await db.deleteFrom('characters').where('account_id', 'in',
      db.selectFrom('accounts').select('id').where('email', '=', EMAIL)).execute();
    await db.deleteFrom('accounts').where('email', '=', EMAIL).execute();
    const acct = await db
      .insertInto('accounts')
      .values({ email: EMAIL, discord_id: null, password_hash: 'x' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const chr = await db
      .insertInto('characters')
      .values({ account_id: acct.id, name: 'Apprentice' })
      .returning('id')
      .executeTakeFirstOrThrow();
    characterId = chr.id;
  });

  it('loadProgress defaults to NotStarted when no row exists', async () => {
    const p = await repo.loadProgress(characterId, PYRO_QUEST_ID);
    expect(p).toEqual({ questId: PYRO_QUEST_ID, state: 'NotStarted', kills: 0 });
  });

  it('saveProgress upserts FSM state and kills', async () => {
    await repo.saveProgress(characterId, { questId: PYRO_QUEST_ID, state: 'InProgress', kills: 2 });
    expect(await repo.loadProgress(characterId, PYRO_QUEST_ID)).toMatchObject({ state: 'InProgress', kills: 2 });
    // overwrite same PK
    await repo.saveProgress(characterId, { questId: PYRO_QUEST_ID, state: 'ReadyToTurnIn', kills: 3 });
    expect(await repo.loadProgress(characterId, PYRO_QUEST_ID)).toMatchObject({ state: 'ReadyToTurnIn', kills: 3 });
  });

  it('listProgress returns every started quest for the character', async () => {
    await repo.saveProgress(characterId, { questId: PYRO_QUEST_ID, state: 'InProgress', kills: 1 });
    await repo.saveProgress(characterId, { questId: BLADE_QUEST_ID, state: 'Completed', kills: 3 });
    const all = await repo.listProgress(characterId);
    expect(all.map((p) => p.questId).sort()).toEqual([BLADE_QUEST_ID, PYRO_QUEST_ID].sort());
  });

  it('listLearned reports Pyromancy as the always-known starter', async () => {
    expect(await repo.listLearned(characterId)).toEqual([PYROMANCY]);
  });

  it('learnDiscipline adds an unlock and is idempotent', async () => {
    await repo.learnDiscipline(characterId, BLADEMASTER);
    await repo.learnDiscipline(characterId, BLADEMASTER); // dupe → no-op
    const learned = await repo.listLearned(characterId);
    expect(learned.sort()).toEqual([BLADEMASTER, PYROMANCY].sort());
  });
});

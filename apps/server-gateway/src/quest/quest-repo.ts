// QuestRepo (S12 #14) — persistence for trainer-quest FSM state and the
// `disciplines_learned` entitlement set. The HTTP layer folds the pure FSM
// transitions (domain `quests.ts`); this repo just loads/stores the result.
//
// Learned set semantics: Pyromancy is the free starter discipline, so it is
// always reported as known even with no rows. `disciplines_learned` records the
// *additional* disciplines unlocked by completing a trainer quest. The equip
// gate (PUT /disciplines) checks against `listLearned`.

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../db/types.js';
import { PYROMANCY, initialProgress, type QuestProgress, type QuestState } from '@mmo/domain';

export interface QuestRepo {
  loadProgress(characterId: string, questId: string): Promise<QuestProgress>;
  saveProgress(characterId: string, progress: QuestProgress): Promise<void>;
  listProgress(characterId: string): Promise<QuestProgress[]>;
  learnDiscipline(characterId: string, disciplineId: string): Promise<void>;
  listLearned(characterId: string): Promise<string[]>;
}

export function createQuestRepo(db: Kysely<Database>): QuestRepo {
  return {
    async loadProgress(characterId, questId) {
      const row = await db
        .selectFrom('character_quests')
        .select(['quest_id as questId', 'state', 'kills'])
        .where('character_id', '=', characterId)
        .where('quest_id', '=', questId)
        .executeTakeFirst();
      if (!row) return initialProgress(questId);
      return { questId: row.questId, state: row.state as QuestState, kills: row.kills };
    },

    async saveProgress(characterId, progress) {
      await db
        .insertInto('character_quests')
        .values({
          character_id: characterId,
          quest_id: progress.questId,
          state: progress.state,
          kills: progress.kills,
          updated_at: sql`now()`,
        })
        .onConflict((oc) =>
          oc.columns(['character_id', 'quest_id']).doUpdateSet({
            state: progress.state,
            kills: progress.kills,
            updated_at: sql`now()`,
          })
        )
        .execute();
    },

    async listProgress(characterId) {
      const rows = await db
        .selectFrom('character_quests')
        .select(['quest_id as questId', 'state', 'kills'])
        .where('character_id', '=', characterId)
        .execute();
      return rows.map((r) => ({ questId: r.questId, state: r.state as QuestState, kills: r.kills }));
    },

    async learnDiscipline(characterId, disciplineId) {
      await db
        .insertInto('disciplines_learned')
        .values({ character_id: characterId, discipline_id: disciplineId })
        .onConflict((oc) => oc.columns(['character_id', 'discipline_id']).doNothing())
        .execute();
    },

    async listLearned(characterId) {
      const rows = await db
        .selectFrom('disciplines_learned')
        .select('discipline_id as disciplineId')
        .where('character_id', '=', characterId)
        .execute();
      // Pyromancy is the always-known starter; merge it with quest unlocks.
      return [...new Set([PYROMANCY, ...rows.map((r) => r.disciplineId)])];
    },
  };
}

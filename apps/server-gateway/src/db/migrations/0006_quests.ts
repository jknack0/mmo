import { Kysely, sql } from 'kysely';

// S12 (#14) — trainer learn-discipline quests.
//
// `disciplines_learned`: the entitlement set. A row means the character has
// completed that discipline's trainer quest and may equip it (the equip gate
// in PUT /disciplines checks this). Pyromancy is the starter — a character with
// no rows is treated as knowing Pyromancy only (see quest-repo `listLearned`).
//
// `character_quests`: persisted quest FSM state (NotStarted is the implicit
// default — absence of a row). Survives relog so progress isn't lost on
// disconnect. Both tables cascade on character delete.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('disciplines_learned')
    .addColumn('character_id', 'uuid', (col) =>
      col.notNull().references('characters.id').onDelete('cascade')
    )
    .addColumn('discipline_id', 'text', (col) => col.notNull())
    .addColumn('learned_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('disciplines_learned_pk', ['character_id', 'discipline_id'])
    .execute();

  await db.schema
    .createTable('character_quests')
    .addColumn('character_id', 'uuid', (col) =>
      col.notNull().references('characters.id').onDelete('cascade')
    )
    .addColumn('quest_id', 'text', (col) => col.notNull())
    .addColumn('state', 'text', (col) => col.notNull())
    .addColumn('kills', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('character_quests_pk', ['character_id', 'quest_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('character_quests').execute();
  await db.schema.dropTable('disciplines_learned').execute();
}

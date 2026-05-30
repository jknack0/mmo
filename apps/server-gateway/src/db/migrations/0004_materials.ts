import { Kysely, sql } from 'kysely';

// S15 (#17) — refinement materials. A placeholder per-character balance the
// tapping economy spends; real material sources (drops, vendor) come later.
// Existing characters backfill to the default.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('characters')
    .addColumn('materials', 'integer', (col) => col.notNull().defaultTo(100))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('characters').dropColumn('materials').execute();
}

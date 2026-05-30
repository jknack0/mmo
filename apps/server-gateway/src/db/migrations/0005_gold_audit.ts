import { Kysely, sql } from 'kysely';

// S16 (#18) — economy. `gold` is the per-character currency the vendor moves.
// `audit_log` is the immutable record ADR-0013 mandates: every vendor trade and
// every consume writes one append-only row (id + actor + action + JSON detail),
// the dupe-prevention / forensics trail. Rows are never updated or deleted.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('characters')
    .addColumn('gold', 'integer', (col) => col.notNull().defaultTo(100))
    .execute();

  await db.schema
    .createTable('audit_log')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn('account_id', 'uuid', (col) =>
      col.references('accounts.id').onDelete('set null')
    )
    .addColumn('character_id', 'uuid', (col) =>
      col.references('characters.id').onDelete('set null')
    )
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('detail', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('audit_log_character_idx')
    .on('audit_log')
    .columns(['character_id', 'created_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('audit_log').execute();
  await db.schema.alterTable('characters').dropColumn('gold').execute();
}

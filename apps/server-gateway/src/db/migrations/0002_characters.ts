import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('characters')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`)
    )
    .addColumn('account_id', 'uuid', (col) =>
      col.notNull().references('accounts.id').onDelete('cascade')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('last_login_at', 'timestamptz')
    .addColumn('snapshot_state', 'jsonb')
    .execute();

  // Per-account name uniqueness (case-insensitive). Different accounts may
  // still pick the same name.
  await db.schema
    .createIndex('characters_account_name_unique')
    .on('characters')
    .columns(['account_id'])
    .expression(sql`lower(name)`)
    .unique()
    .execute();

  // Listing by account is the dominant read pattern.
  await db.schema
    .createIndex('characters_account_id_idx')
    .on('characters')
    .column('account_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('characters').execute();
}

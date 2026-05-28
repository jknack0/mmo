import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`.execute(db);

  await db.schema
    .createTable('accounts')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`)
    )
    .addColumn('discord_id', 'text')
    .addColumn('email', 'text')
    .addColumn('password_hash', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute();

  await db.schema
    .createIndex('accounts_discord_id_unique')
    .on('accounts')
    .column('discord_id')
    .unique()
    .where('discord_id', 'is not', null)
    .execute();

  await db.schema
    .createIndex('accounts_email_unique')
    .on('accounts')
    .column('email')
    .unique()
    .where('email', 'is not', null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('accounts').execute();
}

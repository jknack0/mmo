// Runs once before all tests in this package. Boots the test Postgres
// schema by running every Kysely migration to head.
import { createDb } from './src/db/client.js';
import { runMigrations } from './src/db/migrate.js';
import { env } from './src/env.js';

export async function setup(): Promise<void> {
  const db = createDb(env.databaseUrl);
  try {
    await runMigrations(db);
  } finally {
    await db.destroy();
  }
}

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import { Migrator, FileMigrationProvider } from 'kysely/migration';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(db: Kysely<unknown>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  if (results) {
    for (const r of results) {
      if (r.status === 'Success') {
        console.log(`[migrate] applied ${r.migrationName}`);
      } else if (r.status === 'Error') {
        console.error(`[migrate] failed ${r.migrationName}`);
      }
    }
  }

  if (error) {
    throw error;
  }
}

// CLI entry: `tsx src/db/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { env } = await import('../env.js');
  const { createDb } = await import('./client.js');
  const db = createDb(env.databaseUrl);
  try {
    await runMigrations(db);
    console.log('[migrate] complete');
  } finally {
    await db.destroy();
  }
}

import type { Kysely, Selectable } from 'kysely';
import { sql } from 'kysely';
import type { Database, CharactersTable } from '../db/types.js';

export interface Character {
  id: string;
  accountId: string;
  name: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface CharacterRepo {
  create(input: { accountId: string; name: string }): Promise<Character>;
  listByAccount(accountId: string): Promise<Character[]>;
  findById(id: string): Promise<Character | null>;
  findByAccountAndName(accountId: string, name: string): Promise<Character | null>;
  touchLastLogin(id: string): Promise<void>;
}

function rowToCharacter(row: Selectable<CharactersTable>): Character {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export function createCharacterRepo(db: Kysely<Database>): CharacterRepo {
  return {
    async create(input) {
      const row = await db
        .insertInto('characters')
        .values({ account_id: input.accountId, name: input.name })
        .returningAll()
        .executeTakeFirstOrThrow();
      return rowToCharacter(row);
    },

    async listByAccount(accountId) {
      const rows = await db
        .selectFrom('characters')
        .where('account_id', '=', accountId)
        .orderBy('created_at', 'asc')
        .selectAll()
        .execute();
      return rows.map(rowToCharacter);
    },

    async findById(id) {
      const row = await db
        .selectFrom('characters')
        .where('id', '=', id)
        .selectAll()
        .executeTakeFirst();
      return row ? rowToCharacter(row) : null;
    },

    async findByAccountAndName(accountId, name) {
      const row = await db
        .selectFrom('characters')
        .where('account_id', '=', accountId)
        .where(sql`lower(name)`, '=', name.toLowerCase())
        .selectAll()
        .executeTakeFirst();
      return row ? rowToCharacter(row) : null;
    },

    async touchLastLogin(id) {
      await db
        .updateTable('characters')
        .set({ last_login_at: new Date() })
        .where('id', '=', id)
        .execute();
    },
  };
}

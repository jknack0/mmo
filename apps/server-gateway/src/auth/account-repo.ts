import type { Kysely, Selectable } from 'kysely';
import type { Database, AccountsTable } from '../db/types.js';

export interface Account {
  id: string;
  discordId: string | null;
  email: string | null;
  passwordHash: string | null;
  createdAt: Date;
}

export interface CreateAccountInput {
  discordId?: string | null;
  email?: string | null;
  passwordHash?: string | null;
}

export interface AccountRepo {
  create(input: CreateAccountInput): Promise<Account>;
  findById(id: string): Promise<Account | null>;
  findByEmail(email: string): Promise<Account | null>;
  findByDiscordId(discordId: string): Promise<Account | null>;
}

function rowToAccount(row: Selectable<AccountsTable>): Account {
  return {
    id: row.id,
    discordId: row.discord_id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

export function createAccountRepo(db: Kysely<Database>): AccountRepo {
  return {
    async create(input) {
      const row = await db
        .insertInto('accounts')
        .values({
          discord_id: input.discordId ?? null,
          email: input.email ?? null,
          password_hash: input.passwordHash ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return rowToAccount(row);
    },

    async findById(id) {
      const row = await db
        .selectFrom('accounts')
        .where('id', '=', id)
        .selectAll()
        .executeTakeFirst();
      return row ? rowToAccount(row) : null;
    },

    async findByEmail(email) {
      const row = await db
        .selectFrom('accounts')
        .where('email', '=', email)
        .selectAll()
        .executeTakeFirst();
      return row ? rowToAccount(row) : null;
    },

    async findByDiscordId(discordId) {
      const row = await db
        .selectFrom('accounts')
        .where('discord_id', '=', discordId)
        .selectAll()
        .executeTakeFirst();
      return row ? rowToAccount(row) : null;
    },
  };
}

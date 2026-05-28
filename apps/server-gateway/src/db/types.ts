import type { Generated, JSONColumnType } from 'kysely';

export interface AccountsTable {
  id: Generated<string>;
  discord_id: string | null;
  email: string | null;
  password_hash: string | null;
  created_at: Generated<Date>;
}

export interface CharactersTable {
  id: Generated<string>;
  account_id: string;
  name: string;
  created_at: Generated<Date>;
  last_login_at: Date | null;
  snapshot_state: JSONColumnType<Record<string, unknown>> | null;
}

export interface Database {
  accounts: AccountsTable;
  characters: CharactersTable;
}

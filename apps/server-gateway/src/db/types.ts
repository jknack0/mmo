import type { Generated } from 'kysely';

export interface AccountsTable {
  id: Generated<string>;
  discord_id: string | null;
  email: string | null;
  password_hash: string | null;
  created_at: Generated<Date>;
}

export interface Database {
  accounts: AccountsTable;
}

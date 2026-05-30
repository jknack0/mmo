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
  /** Refinement materials balance (S15). */
  materials: Generated<number>;
  /** Gold currency balance (S16). */
  gold: Generated<number>;
}

/** Append-only audit trail (S16, ADR-0013). Rows are never updated or deleted. */
export interface AuditLogTable {
  id: Generated<string>;
  account_id: string | null;
  character_id: string | null;
  action: string;
  detail: JSONColumnType<Record<string, unknown>>;
  created_at: Generated<Date>;
}

export interface ItemsTable {
  id: Generated<string>;
  owner_character_id: string | null;
  base_id: string;
  affixes: JSONColumnType<unknown[]>;
  refinement: Generated<number>;
  pity_counter: Generated<number>;
  created_at: Generated<Date>;
}

export interface InventoryTable {
  character_id: string;
  slot: number;
  item_id: string;
}

export interface EquippedTable {
  character_id: string;
  gear_slot: string;
  item_id: string;
}

export interface Database {
  accounts: AccountsTable;
  characters: CharactersTable;
  items: ItemsTable;
  inventory: InventoryTable;
  equipped: EquippedTable;
  audit_log: AuditLogTable;
}

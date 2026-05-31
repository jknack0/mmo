// Minimal Kysely schema the channel touches (S13). Mirrors the gateway's item
// tables (migrations live in the gateway). Only the columns the channel reads
// or writes are declared.

import type { Generated, JSONColumnType } from 'kysely';

/** Append-only audit trail (S16, ADR-0013). The channel appends consume rows. */
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

/** Minimal characters view the channel touches (S20 Rift reward materials,
 *  S22 session snapshot for crash recovery). */
export interface CharactersTable {
  id: Generated<string>;
  materials: Generated<number>;
  /** Last-flushed session state (S22, ADR-0013): zone, position, HP. */
  snapshot_state: JSONColumnType<Record<string, unknown>> | null;
}

export interface ChannelDatabase {
  items: ItemsTable;
  inventory: InventoryTable;
  equipped: EquippedTable;
  audit_log: AuditLogTable;
  characters: CharactersTable;
}

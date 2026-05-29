// Channel-side Postgres client (S13 #15). Per ADR-0013 the channel is the
// authoritative game server that detects mob-death drops and pickups — both
// high-value events that must write through to Postgres — so the channel owns
// a small read/write footprint over the item tables. The gateway remains the
// owner of migrations + the full InventoryRepo; this is the minimal slice the
// channel needs.

import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { ChannelDatabase } from './types.js';

const { Pool } = pg;

export function createChannelDb(connectionString: string): Kysely<ChannelDatabase> {
  const pool = new Pool({ connectionString, max: 5 });
  return new Kysely<ChannelDatabase>({ dialect: new PostgresDialect({ pool }) });
}

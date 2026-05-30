// AuditRepo (S16 #18, ADR-0013) — the append-only audit trail. Every vendor
// trade and consume writes one immutable row here: who (account + character),
// what (action), and a JSON detail blob. Rows are never updated or deleted, so
// the table is the forensic / dupe-detection record of all economy actions.
//
// `insertAudit` is exported separately so a service can append inside its own
// transaction (atomic with the gold move it records).

import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

export interface AuditEntry {
  action: string;
  accountId?: string | null;
  characterId?: string | null;
  detail?: Record<string, unknown>;
}

export interface AuditRow {
  id: string;
  accountId: string | null;
  characterId: string | null;
  action: string;
  detail: Record<string, unknown>;
  createdAt: Date;
}

/** Append one audit row using the given executor (a db handle or a transaction). */
export async function insertAudit(ex: Kysely<Database>, entry: AuditEntry): Promise<void> {
  await ex
    .insertInto('audit_log')
    .values({
      account_id: entry.accountId ?? null,
      character_id: entry.characterId ?? null,
      action: entry.action,
      detail: JSON.stringify(entry.detail ?? {}),
    })
    .execute();
}

export interface AuditRepo {
  append(entry: AuditEntry): Promise<void>;
  list(characterId: string): Promise<AuditRow[]>;
}

export function createAuditRepo(db: Kysely<Database>): AuditRepo {
  return {
    append: (entry) => insertAudit(db, entry),

    async list(characterId) {
      const rows = await db
        .selectFrom('audit_log')
        .select(['id', 'account_id as accountId', 'character_id as characterId', 'action', 'detail', 'created_at as createdAt'])
        .where('character_id', '=', characterId)
        .orderBy('created_at', 'desc')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        characterId: r.characterId,
        action: r.action,
        detail: (r.detail ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt,
      }));
    },
  };
}

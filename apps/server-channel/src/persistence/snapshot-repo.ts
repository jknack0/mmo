// SnapshotRepo + SnapshotWorker state (S22 #24, ADR-0013). The channel holds a
// player's live position + HP only in memory; on a crash that state is lost. The
// SnapshotWorker periodically (and on zone change + clean logout) flushes it to
// `characters.snapshot_state` so a reconnecting player is restored where they
// were instead of re-spawning fresh. Loadout/discipline already live durably in
// Redis/Postgres, so the snapshot only needs the volatile bits.

import type { Kysely } from 'kysely';
import type { ChannelDatabase } from '../db/types.js';
import type { ServerPlayer } from '../zone/zone-state.js';

export interface SnapshotState {
  /** Zone the player was in — restore only applies within the same zone. */
  zoneId: string;
  pos: { x: number; y: number };
  hp: number;
  maxHp: number;
  dead: boolean;
  /** Wall-clock ms the snapshot was taken (caller supplies; keeps this pure). */
  ts: number;
}

/** Pure: capture the volatile session state of a player in a given zone. */
export function buildSnapshotState(
  player: Pick<ServerPlayer, 'pos' | 'hp' | 'maxHp' | 'dead'>,
  zoneId: string,
  ts: number
): SnapshotState {
  return {
    zoneId,
    pos: { x: player.pos.x, y: player.pos.y },
    hp: player.hp,
    maxHp: player.maxHp,
    dead: player.dead,
    ts,
  };
}

export interface SnapshotRepo {
  write(characterId: string, state: SnapshotState): Promise<void>;
  read(characterId: string): Promise<SnapshotState | null>;
}

export function createSnapshotRepo(db: Kysely<ChannelDatabase>): SnapshotRepo {
  return {
    async write(characterId, state) {
      await db
        .updateTable('characters')
        .set({ snapshot_state: JSON.stringify(state) })
        .where('id', '=', characterId)
        .execute();
    },

    async read(characterId) {
      const row = await db
        .selectFrom('characters')
        .select('snapshot_state')
        .where('id', '=', characterId)
        .executeTakeFirst();
      const s = row?.snapshot_state;
      return s ? (s as unknown as SnapshotState) : null;
    },
  };
}

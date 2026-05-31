// Rift instance logic (S19 #21, ADR-0007) — the canonical endgame loop. A Rift
// is a private instanced dungeon with two phases:
//   Phase 1 (wave-clear): kill a quota of trash mobs.
//   Phase 2 (mini-boss):  a single heavy boss spawns; killing it completes.
// On completion the party is returned to town. This file is the pure phase
// machine + the spawn definitions; the channel hosts the live instance.

import { ASHEN_PLAINS } from './zones.js';
import { rollGuaranteedDrop, type ItemDrop } from './drop-table.js';

export const RIFT_T1_ZONE_ID = 'rift-t1';

/** Phase-1 kill quota before the boss appears (~10–15 min run at alpha). */
export const RIFT_KILL_QUOTA = 30;

/** How many trash mobs are kept alive at once during the wave-clear. */
export const RIFT_WAVE_SIZE = 6;

/** Trash mob spawned during wave-clear. */
export const RIFT_TRASH = { kind: 'skeleton', maxHp: 60 };

/** The mini-boss: far more HP and a heavier bite than zone trash. */
export const RIFT_BOSS = { id: 'rift-boss', kind: 'skeleton-lord', maxHp: 600 };

export type RiftPhase = 'wave-clear' | 'mini-boss' | 'complete';

export interface RiftState {
  phase: RiftPhase;
  /** Trash kills banked toward the quota (phase 1 only). */
  kills: number;
  quota: number;
}

export function createRiftState(quota: number = RIFT_KILL_QUOTA): RiftState {
  return { phase: 'wave-clear', kills: 0, quota };
}

/**
 * Advance the Rift on a mob death. A trash kill in phase 1 banks toward the
 * quota and flips to the boss phase once met; the boss death in phase 2
 * completes the Rift. Returns a new state (pure) — unrecognised kills no-op.
 */
export function recordRiftKill(state: RiftState, isBoss: boolean): RiftState {
  if (state.phase === 'wave-clear' && !isBoss) {
    const kills = state.kills + 1;
    return kills >= state.quota
      ? { ...state, kills: state.quota, phase: 'mini-boss' }
      : { ...state, kills };
  }
  if (state.phase === 'mini-boss' && isBoss) {
    return { ...state, phase: 'complete' };
  }
  return state;
}

export function riftComplete(state: RiftState): boolean {
  return state.phase === 'complete';
}

/** Where a finished (or abandoned) Rift returns the player. */
export const RIFT_EXIT_ZONE_ID = 'hold-veridian';

// ─── Run rules + reward (S20 #22, ADR-0008/0007) ──────────────

/** Deaths that fail a Rift run (party-wide). */
export const MAX_RIFT_DEATHS = 3;

/** Materials granted on a successful boss kill (tapping-input placeholder). */
export const RIFT_REWARD_MATERIALS = 50;

/** Magic Find applied to the guaranteed boss reward (richer than trash drops). */
export const RIFT_REWARD_MAGIC_FIND = 100;

export type RiftDeathOutcome = 'revive' | 'fail';

/** Outcome of a death in a Rift: revive in-place, or fail the run at the cap. */
export function riftDeathOutcome(deathsAfter: number): RiftDeathOutcome {
  return deathsAfter >= MAX_RIFT_DEATHS ? 'fail' : 'revive';
}

/** Roll the guaranteed boss reward item (rarity per S14, MF-boosted). */
export function rollRiftReward(rng: () => number): ItemDrop {
  return rollGuaranteedDrop(RIFT_TRASH.kind, rng, RIFT_REWARD_MAGIC_FIND);
}

/** Sanity re-export so callers don't hardcode the open-zone id elsewhere. */
export const RIFT_OPEN_ZONE_ID = ASHEN_PLAINS;

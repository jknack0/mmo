// Death + respawn economy (S18 #20, ADR-0008). Open-world death is cheap: no XP
// loss (there's no XP system, and ADR-0008 forbids it anyway), just a small gold
// cost standing in for repair/durability until that lands post-alpha, and a
// relocation to the nearest safe town.

import { HOLD_VERIDIAN } from './zones.js';

/** Gold deducted on respawn — the repair-cost placeholder. */
export const RESPAWN_GOLD_COST = 25;

/** Where a downed player wakes up: the alpha's only town. */
export const SAFE_ZONE_ID = HOLD_VERIDIAN;

/** Gold a player actually loses on respawn — never more than they hold. */
export function respawnCost(currentGold: number): number {
  return Math.min(RESPAWN_GOLD_COST, Math.max(0, currentGold));
}

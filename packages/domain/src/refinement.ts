// Refinement / tapping (S15 #17) per ADR-0005. An item carries a Refinement
// level (+0..cap) that multiplies all its numeric stats. Tapping consumes
// materials and either raises Refinement (success) or burns the materials and
// leaves the item untouched (failure) — never destroyed. A pity counter
// guarantees success after enough consecutive failures. The cap is bounded by
// the item's rarity tier so a tapped white can't obsolete a rare.
//
// Pure rule logic — the gateway's TappingService wraps this in a Postgres
// transaction (material consume + item update).

import type { Rarity } from './affixes.js';

/** Each Refinement level adds this fraction to the item's numeric stats. */
export const REFINEMENT_PER_LEVEL = 0.05;

/** Stat multiplier applied to an item's numeric stats at a Refinement level. */
export function refinementMultiplier(level: number): number {
  return 1 + REFINEMENT_PER_LEVEL * Math.max(0, level);
}

/** Refinement cap per rarity — higher tiers tap further (ADR-0005). */
export const REFINEMENT_CAP: Record<Rarity, number> = {
  white: 5,
  blue: 7,
  yellow: 9,
  gold: 10,
};

export function refinementCap(rarity: Rarity): number {
  return REFINEMENT_CAP[rarity];
}

/** Materials consumed per tap attempt (placeholder economy at alpha). */
export const TAP_COST = 10;

/** Consecutive failures after which the next tap is guaranteed to succeed. */
export const PITY_THRESHOLD = 5;

/**
 * Success chance for a tap that would raise the item to `targetLevel`. High at
 * low levels, declining toward the cap, floored at 25% so high refines stay
 * possible without pity.
 */
export function tapSuccessChance(targetLevel: number): number {
  const c = 0.95 - 0.07 * (targetLevel - 1);
  return Math.max(0.25, Math.min(0.95, c));
}

export type TapOutcome = 'success' | 'fail' | 'capped';

export interface TapInput {
  refinement: number;
  pityCounter: number;
  cap: number;
  /** Uniform [0,1) — injected so the rule is deterministic + testable. */
  roll: number;
}

export interface TapResult {
  outcome: TapOutcome;
  newRefinement: number;
  pityCounter: number;
}

/**
 * Resolve a single tap. Already-capped items short-circuit to `capped` (no
 * material spend should occur — the service checks this first too). Otherwise
 * the pity counter forces success past the threshold; on success Refinement
 * rises and pity resets, on failure Refinement holds and pity increments.
 */
export function resolveTap(input: TapInput): TapResult {
  const { refinement, pityCounter, cap, roll } = input;
  if (refinement >= cap) {
    return { outcome: 'capped', newRefinement: refinement, pityCounter };
  }
  const target = refinement + 1;
  const guaranteed = pityCounter >= PITY_THRESHOLD;
  if (guaranteed || roll < tapSuccessChance(target)) {
    return { outcome: 'success', newRefinement: target, pityCounter: 0 };
  }
  return { outcome: 'fail', newRefinement: refinement, pityCounter: pityCounter + 1 };
}

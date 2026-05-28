// Spirit + Wrath resource model per ADR-0010.
//
// Spirit = fast-regenerating spam budget. Regenerates passively at ~1.5%/s
// out of combat and ~0.5%/s in combat; caps at maxSpirit (INT raises it).
//
// Wrath = combat-built ultimate resource. Builds from dealing damage,
// decays slowly out of combat, caps at maxWrath. Empty at fight start.

export const COMBAT_GRACE_MS = 5_000;
export const SPIRIT_REGEN_OOC_PCT = 0.015;
export const SPIRIT_REGEN_IC_PCT = 0.005;
export const WRATH_DECAY_OOC_PCT = 0.02;
export const WRATH_GAIN_PER_DAMAGE = 0.5;

export interface ResourceState {
  spirit: number;
  maxSpirit: number;
  wrath: number;
  maxWrath: number;
  /** Wall-clock ms when this player last dealt or took damage. */
  lastCombatAt: number;
}

export function createResourceState(opts: { maxSpirit: number; maxWrath: number }): ResourceState {
  return {
    spirit: opts.maxSpirit,
    maxSpirit: opts.maxSpirit,
    wrath: 0,
    maxWrath: opts.maxWrath,
    lastCombatAt: 0,
  };
}

export function inCombat(state: ResourceState, nowMs: number): boolean {
  if (state.lastCombatAt === 0) return false;
  return nowMs - state.lastCombatAt < COMBAT_GRACE_MS;
}

export function stepResources(state: ResourceState, dtSec: number, nowMs: number): void {
  const ic = inCombat(state, nowMs);
  const spiritRate = ic ? SPIRIT_REGEN_IC_PCT : SPIRIT_REGEN_OOC_PCT;
  state.spirit = Math.min(state.maxSpirit, state.spirit + state.maxSpirit * spiritRate * dtSec);

  if (!ic) {
    const decay = state.maxWrath * WRATH_DECAY_OOC_PCT * dtSec;
    state.wrath = Math.max(0, state.wrath - decay);
  }
}

export function onDamageDealt(state: ResourceState, damage: number, nowMs: number): void {
  state.lastCombatAt = nowMs;
  state.wrath = Math.min(state.maxWrath, state.wrath + damage * WRATH_GAIN_PER_DAMAGE);
}

export function spendSpirit(state: ResourceState, amount: number): boolean {
  if (state.spirit < amount) return false;
  state.spirit -= amount;
  return true;
}

export function spendWrath(state: ResourceState, amount: number): boolean {
  if (state.wrath < amount) return false;
  state.wrath -= amount;
  return true;
}

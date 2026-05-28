// Pyromancy tripod choices per docs/disciplines/pyromancy.md.
//
// Each skill exposes 2 tiers × 3 choices = 9 build combinations.
// Tier 1 = vector tradeoff (damage / range / cd / Burn-apply).
// Tier 2 = archetype lean — every skill offers one [B]urn, one [D]irect,
// and one [U]tility choice so the player can tilt the whole loadout
// toward a sub-archetype via tripod selection alone (per ADR-0018).
//
// Numeric transforms (damage / range / cooldown / Burn stacks / detonate
// flags) drive real combat behaviour. Flavour-only effects (knockback,
// stun, lingering ground patches, heal-on-hit) are captured in the choice
// label/description for the selector UI but currently no-op at runtime;
// those land with the AoE / status-effect work in later slices.

import type { SkillDef } from './combat-system.js';

export interface TripodChoice {
  id: string;
  label: string;
  description: string;
  /** Tier-2 archetype lean — every skill ships one of each. */
  archetype?: 'burn' | 'direct' | 'utility';

  // ─── Mechanical modifiers ─────────────────────────────────────
  dmgMult?: number;
  rangeMult?: number;
  cdMult?: number;
  cdAddMs?: number;

  /** Add this many Burn stacks on top of the base burnStacksApplied. */
  burnStacksAdded?: number;
  /** If true, force burnStacksApplied to 0 regardless of base / additions. */
  removeBurnApply?: boolean;

  /** Turn the skill into a Burn detonator. */
  detonatesBurn?: boolean;
  detonateBonusPerStack?: number;

  spiritCostMult?: number;
  wrathCostMult?: number;
}

export interface SkillTripod {
  /** Tier-1 (vector) choices — 3 mutually exclusive. */
  t1: [TripodChoice, TripodChoice, TripodChoice];
  /** Tier-2 (archetype) choices — 3 mutually exclusive, one of each lean. */
  t2: [TripodChoice, TripodChoice, TripodChoice];
}

export interface PlayerTripodSelection {
  /** Index into tripod.t1 (0, 1, or 2). Use -1 for none. */
  t1: number;
  /** Index into tripod.t2. Use -1 for none. */
  t2: number;
}

export type PlayerTripodLoadout = Record<string, PlayerTripodSelection>;

/**
 * Apply one player's chosen tripod selection to the base SkillDef and
 * return a modified SkillDef the combat resolver consumes.
 */
export function applyTripod(
  base: SkillDef,
  sel: PlayerTripodSelection,
  tripod: SkillTripod
): SkillDef {
  let def: SkillDef = { ...base };
  if (sel.t1 >= 0 && sel.t1 < tripod.t1.length) {
    def = applyChoice(def, tripod.t1[sel.t1]!);
  }
  if (sel.t2 >= 0 && sel.t2 < tripod.t2.length) {
    def = applyChoice(def, tripod.t2[sel.t2]!);
  }
  return def;
}

function applyChoice(def: SkillDef, c: TripodChoice): SkillDef {
  const next: SkillDef = { ...def };
  if (c.dmgMult != null) next.damage = next.damage * c.dmgMult;
  if (c.rangeMult != null) next.rangeTiles = next.rangeTiles * c.rangeMult;
  if (c.cdMult != null) next.cooldownMs = next.cooldownMs * c.cdMult;
  if (c.cdAddMs != null) next.cooldownMs = Math.max(0, next.cooldownMs + c.cdAddMs);
  if (c.spiritCostMult != null) next.spiritCost = next.spiritCost * c.spiritCostMult;
  if (c.wrathCostMult != null) next.wrathCost = next.wrathCost * c.wrathCostMult;
  if (c.burnStacksAdded != null) {
    next.burnStacksApplied = (next.burnStacksApplied ?? 0) + c.burnStacksAdded;
  }
  if (c.removeBurnApply) next.burnStacksApplied = 0;
  if (c.detonatesBurn != null) next.detonatesBurn = c.detonatesBurn;
  if (c.detonateBonusPerStack != null) next.detonateBonusPerStack = c.detonateBonusPerStack;
  return next;
}

// ─── 72 Pyromancy tripod options ──────────────────────────────

const T = (c: TripodChoice): TripodChoice => c;

export const PYROMANCY_TRIPODS: Record<string, SkillTripod> = {
  // ── 1. Ember Step (mobility) ────────────────────────────────
  'ember-step': {
    t1: [
      T({ id: 'long-step', label: 'Long Step', description: '+50% dash distance.', rangeMult: 1.5 }),
      T({ id: 'quick-step', label: 'Quick Step', description: 'Cooldown 8s → 5s.', cdMult: 5 / 8 }),
      T({ id: 'searing-step', label: 'Searing Step', description: '+1 Burn stack along trail.', burnStacksAdded: 1 }),
    ],
    t2: [
      T({ id: 'phoenix-step', label: 'Phoenix Step', description: 'i-frames during the dash.', archetype: 'utility' }),
      T({ id: 'detonating-step', label: 'Detonating Step', description: '+50% damage on landing tile, no Burn.', archetype: 'direct', dmgMult: 1.5, removeBurnApply: true }),
      T({ id: 'smoldering-step', label: 'Smoldering Step', description: 'Trail persists 3s ticking Burn.', archetype: 'burn', burnStacksAdded: 1 }),
    ],
  },

  // ── 2. Spark (spammable) ────────────────────────────────────
  spark: {
    t1: [
      T({ id: 'heavy-spark', label: 'Heavy Spark', description: '+30% damage, +0.2s cooldown.', dmgMult: 1.3, cdAddMs: 200 }),
      T({ id: 'twin-spark', label: 'Twin Spark', description: 'Chains to one nearby enemy at -25% damage each.', dmgMult: 0.75 }),
      T({ id: 'igniting-spark', label: 'Igniting Spark', description: '50% chance to apply 1 Burn.', burnStacksAdded: 1 }),
    ],
    t2: [
      T({ id: 'crit-spark', label: 'Critical Spark', description: '+15% crit chance with Fire damage.', archetype: 'direct', dmgMult: 1.15 }),
      T({ id: 'ember-spark', label: 'Ember Spark', description: 'Free cast vs Burned targets.', archetype: 'burn', spiritCostMult: 0 }),
      T({ id: 'stun-spark', label: 'Stun Spark', description: '3% chance to stun for 0.5s.', archetype: 'utility' }),
    ],
  },

  // ── 3. Cinder Spray (spammable) ─────────────────────────────
  'cinder-spray': {
    t1: [
      T({ id: 'wide-spray', label: 'Wide Spray', description: '+50% cone angle.', rangeMult: 1.2 }),
      T({ id: 'long-spray', label: 'Long Spray', description: '+50% cone range.', rangeMult: 1.5 }),
      T({ id: 'hot-spray', label: 'Hot Spray', description: '+1 Burn stack applied.', burnStacksAdded: 1 }),
    ],
    t2: [
      T({ id: 'cleaving-spray', label: 'Cleaving Spray', description: '+25% damage but no Burn.', archetype: 'direct', dmgMult: 1.25, removeBurnApply: true }),
      T({ id: 'smoldering-spray', label: 'Smoldering Spray', description: 'Leaves a 2s ground patch in the cone.', archetype: 'burn', burnStacksAdded: 1 }),
      T({ id: 'pushing-spray', label: 'Pushing Spray', description: 'Small knockback on hit targets.', archetype: 'utility' }),
    ],
  },

  // ── 4. Heat Wave (spammable PBAOE) ──────────────────────────
  'heat-wave': {
    t1: [
      T({ id: 'wider-wave', label: 'Wider Wave', description: '+30% radius.', rangeMult: 1.3 }),
      T({ id: 'hotter-wave', label: 'Hotter Wave', description: '+30% damage.', dmgMult: 1.3 }),
      T({ id: 'lingering-wave', label: 'Lingering Wave', description: 'Leaves a 3s patch at the caster.' }),
    ],
    t2: [
      T({ id: 'burn-wave', label: 'Burn Wave', description: 'Applies 2 Burn stacks at -20% direct damage.', archetype: 'burn', burnStacksAdded: 2, dmgMult: 0.8 }),
      T({ id: 'crit-wave', label: 'Crit Wave', description: '+30% crit chance with Fire damage.', archetype: 'direct', dmgMult: 1.3 }),
      T({ id: 'cleansing-wave', label: 'Cleansing Wave', description: 'Also clears one debuff from the caster.', archetype: 'utility' }),
    ],
  },

  // ── 5. Fireball (mid-cd burst) ──────────────────────────────
  fireball: {
    t1: [
      T({ id: 'concussive-fireball', label: 'Concussive Fireball', description: '+25% damage, +0.3s cast time.', dmgMult: 1.25, cdAddMs: 300 }),
      T({ id: 'greater-range', label: 'Greater Range', description: '+50% range, +20% travel speed.', rangeMult: 1.5 }),
      T({ id: 'searing-fireball', label: 'Searing Fireball', description: '+20% radius, applies 1 Burn.', burnStacksAdded: 1 }),
    ],
    t2: [
      T({ id: 'triple-fireball', label: 'Triple Fireball', description: 'Fires 3 fireballs in a cone at 50% damage each.', archetype: 'direct', dmgMult: 0.5 }),
      T({ id: 'detonate-on-burn', label: 'Detonate on Burn', description: 'Consumes Burn stacks for +15 damage per stack.', archetype: 'burn', detonatesBurn: true, detonateBonusPerStack: 15 }),
      T({ id: 'shrapnel-fireball', label: 'Shrapnel Fireball', description: 'Explosion leaves a 2s lingering ground patch.', archetype: 'burn', burnStacksAdded: 1 }),
    ],
  },

  // ── 6. Flame Lance (mid-cd line) ────────────────────────────
  'flame-lance': {
    t1: [
      T({ id: 'heavy-lance', label: 'Heavy Lance', description: '+30% damage, +0.4s cast time.', dmgMult: 1.3, cdAddMs: 400 }),
      T({ id: 'long-lance', label: 'Long Lance', description: '+50% range.', rangeMult: 1.5 }),
      T({ id: 'searing-lance', label: 'Searing Lance', description: '+1 Burn on each pierced enemy.', burnStacksAdded: 1 }),
    ],
    t2: [
      T({ id: 'twin-lance', label: 'Twin Lance', description: 'Fires 2 lances at 60% damage each in a small cone.', archetype: 'direct', dmgMult: 0.6 }),
      T({ id: 'igniting-lance', label: 'Igniting Lance', description: 'Lance leaves a 3s fire trail.', archetype: 'burn', burnStacksAdded: 1 }),
      T({ id: 'anchoring-lance', label: 'Anchoring Lance', description: 'First hit enemy slowed 50% for 2s.', archetype: 'utility' }),
    ],
  },

  // ── 7. Combust (mid-cd detonator) ───────────────────────────
  combust: {
    t1: [
      T({ id: 'wider-combust', label: 'Wider Combust', description: '+40% detonation radius.', rangeMult: 1.4 }),
      T({ id: 'hotter-combust', label: 'Hotter Combust', description: '+15% damage per Burn stack consumed.', detonateBonusPerStack: 20 }),
      T({ id: 'faster-combust', label: 'Faster Combust', description: 'Cooldown 12s → 8s.', cdMult: 8 / 12 }),
    ],
    t2: [
      T({ id: 'chain-combust', label: 'Chain Combust', description: 'Spreads remaining Burn to nearby enemies first.', archetype: 'burn' }),
      T({ id: 'pure-combust', label: 'Pure Combust', description: 'Works without Burn — flat damage, smaller radius.', archetype: 'direct', dmgMult: 1.2 }),
      T({ id: 'snuffing-combust', label: 'Snuffing Combust', description: 'Each consumed stack heals you 1% HP, cap 10%.', archetype: 'utility' }),
    ],
  },

  // ── 8. Meteor (heavy nuke) ──────────────────────────────────
  meteor: {
    t1: [
      T({ id: 'greater-meteor', label: 'Greater Meteor', description: '+25% radius, +0.5s wind-up.', rangeMult: 1.25, cdAddMs: 500 }),
      T({ id: 'hotter-meteor', label: 'Hotter Meteor', description: '+30% damage.', dmgMult: 1.3 }),
      T({ id: 'searing-meteor', label: 'Searing Meteor', description: 'Applies 3 Burn stacks on impact.', burnStacksAdded: 3 }),
    ],
    t2: [
      T({ id: 'twin-meteor', label: 'Twin Meteor', description: 'Drops 2 smaller meteors at 60% damage each.', archetype: 'direct', dmgMult: 0.6 }),
      T({ id: 'cratering-meteor', label: 'Cratering Meteor', description: 'Impact leaves a 4s fire patch.', archetype: 'burn', burnStacksAdded: 2 }),
      T({ id: 'stunning-meteor', label: 'Stunning Meteor', description: 'Impact stuns enemies in radius for 1s.', archetype: 'utility' }),
    ],
  },

  // ── 9. Firestorm (heavy nuke ground patch) ──────────────────
  firestorm: {
    t1: [
      T({ id: 'larger-firestorm', label: 'Larger Firestorm', description: '+30% radius.', rangeMult: 1.3 }),
      T({ id: 'longer-firestorm', label: 'Longer Firestorm', description: '+50% duration.' }),
      T({ id: 'hotter-firestorm', label: 'Hotter Firestorm', description: '+30% damage, but no Burn applied.', dmgMult: 1.3, removeBurnApply: true }),
    ],
    t2: [
      T({ id: 'pulsing-firestorm', label: 'Pulsing Firestorm', description: 'Every 2s, a mini-boom radiates from the centre.', archetype: 'direct', dmgMult: 1.15 }),
      T({ id: 'pyroclastic-firestorm', label: 'Pyroclastic Firestorm', description: 'Applies 1 Burn stack per tick.', archetype: 'burn', burnStacksAdded: 1 }),
      T({ id: 'mobile-firestorm', label: 'Mobile Firestorm', description: 'Follows the caster for the duration.', archetype: 'utility' }),
    ],
  },

  // ── 10. Wall of Flame (utility) ─────────────────────────────
  'wall-of-flame': {
    t1: [
      T({ id: 'long-wall', label: 'Long Wall', description: '+50% length.', rangeMult: 1.5 }),
      T({ id: 'tall-wall', label: 'Tall Wall', description: '+50% duration.' }),
      T({ id: 'hot-wall', label: 'Hot Wall', description: '+30% damage per tick.', dmgMult: 1.3 }),
    ],
    t2: [
      T({ id: 'crushing-wall', label: 'Crushing Wall', description: 'Blocks enemy projectiles + line of sight.', archetype: 'utility' }),
      T({ id: 'cremating-wall', label: 'Cremating Wall', description: 'Applies 2 Burn stacks per tick.', archetype: 'burn', burnStacksAdded: 2 }),
      T({ id: 'detonating-wall', label: 'Detonating Wall', description: 'Wall explodes for damage on expire.', archetype: 'direct', dmgMult: 1.25 }),
    ],
  },

  // ── 11. Pyroclasm (elite) ───────────────────────────────────
  pyroclasm: {
    t1: [
      T({ id: 'wider-pyroclasm', label: 'Wider Pyroclasm', description: '+50% column radius.', rangeMult: 1.5 }),
      T({ id: 'sustained-pyroclasm', label: 'Sustained Pyroclasm', description: '+50% channel duration.', cdAddMs: 1500 }),
      T({ id: 'searing-pyroclasm', label: 'Searing Pyroclasm', description: 'Applies max Burn stacks instantly.', burnStacksAdded: 5 }),
    ],
    t2: [
      T({ id: 'annihilating-pyroclasm', label: 'Annihilating Pyroclasm', description: '+40% damage but no Burn.', archetype: 'direct', dmgMult: 1.4, removeBurnApply: true }),
      T({ id: 'vaporizing-pyroclasm', label: 'Vaporizing Pyroclasm', description: 'Consumes Burn stacks for +damage per stack.', archetype: 'burn', detonatesBurn: true, detonateBonusPerStack: 25 }),
      T({ id: 'radiant-pyroclasm', label: 'Radiant Pyroclasm', description: 'Heals allies in the column 5% HP/s.', archetype: 'utility' }),
    ],
  },

  // ── 12. Cataclysm (elite screen-clear) ──────────────────────
  cataclysm: {
    t1: [
      T({ id: 'greater-cataclysm', label: 'Greater Cataclysm', description: '+25% area.', rangeMult: 1.25 }),
      T({ id: 'hotter-cataclysm', label: 'Hotter Cataclysm', description: '+25% damage per meteor.', dmgMult: 1.25 }),
      T({ id: 'searing-cataclysm', label: 'Searing Cataclysm', description: 'Applies 3 Burn stacks per meteor hit.', burnStacksAdded: 3 }),
    ],
    t2: [
      T({ id: 'apocalyptic-cataclysm', label: 'Apocalyptic Cataclysm', description: 'Doubles meteor count at -30% damage each.', archetype: 'direct', dmgMult: 0.7 }),
      T({ id: 'smoldering-cataclysm', label: 'Smoldering Cataclysm', description: 'Each meteor leaves a 3s ground patch.', archetype: 'burn', burnStacksAdded: 2 }),
      T({ id: 'ascending-cataclysm', label: 'Ascending Cataclysm', description: 'Caster is invulnerable during the 2s cast.', archetype: 'utility' }),
    ],
  },
};

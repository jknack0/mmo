// StatCalculator (S10 #12) — pure derivation of a player's combat-affecting
// stats from their allocated passives. Deep module: one function, no I/O, no
// dependency on combat internals. Combat (apps/server-channel) folds the
// returned multipliers/flags into damage, cooldowns, resources, and Burn.
//
// Conventions:
//   *Mult fields start at 1.0 and accumulate additive percentage bonuses
//   (so two +5% nodes give 1.10, matching how players reason about a tree).
//   critChance is an additive fraction starting at 0.

import { PASSIVE_NODES, type PassiveAllocation, type PassiveMod } from './passives.js';

/** Default Burn stack cap before Searing Touch / Inferno modify it. */
export const DEFAULT_BURN_STACK_CAP = 5;

export interface DerivedStats {
  fireDamageMult: number;
  burnDamageMult: number;
  burnDurationMult: number;
  /** Additive crit chance, 0..1. */
  critChance: number;
  /** Extra multiplier applied on explosion-type skills (on top of fire). */
  explosionDamageMult: number;
  /** Multiplier on heavy-nuke cooldowns (0.9 = -10%). */
  heavyNukeCdMult: number;
  maxSpiritMult: number;
  wrathGenMult: number;
  /** Multiplier on a detonator's per-stack bonus damage. */
  detonatorDamagePerStackMult: number;
  /** Effective Burn stack cap. Infinity once Inferno is taken. */
  maxBurnStacks: number;
  // ─── Keystone flags ───
  flashburn: boolean;
  inferno: boolean;
  pyromancersWard: boolean;
  /** Runtime-mechanic node keys (procs/buffs/CC) consumed by combat systems. */
  flags: string[];
}

export interface StatContext {
  /** How many Pyro skills the player has equipped (drives Annihilator). */
  equippedPyroSkillCount?: number;
  /** Override the base Burn cap (defaults to DEFAULT_BURN_STACK_CAP). */
  baseBurnStackCap?: number;
}

export function baseDerivedStats(cap: number = DEFAULT_BURN_STACK_CAP): DerivedStats {
  return {
    fireDamageMult: 1,
    burnDamageMult: 1,
    burnDurationMult: 1,
    critChance: 0,
    explosionDamageMult: 1,
    heavyNukeCdMult: 1,
    maxSpiritMult: 1,
    wrathGenMult: 1,
    detonatorDamagePerStackMult: 1,
    maxBurnStacks: cap,
    flashburn: false,
    inferno: false,
    pyromancersWard: false,
    flags: [],
  };
}

const NODE_BY_ID = new Map(PASSIVE_NODES.map((n) => [n.id, n]));

function applyMod(s: DerivedStats, mod: PassiveMod, ctx: Required<StatContext>): void {
  if ('kind' in mod) {
    if (mod.kind === 'flag') {
      s.flags.push(mod.key);
      return;
    }
    // keystone
    switch (mod.key) {
      case 'flashburn':
        s.flashburn = true;
        s.fireDamageMult += 0.4;
        break;
      case 'inferno':
        s.inferno = true;
        s.maxBurnStacks = Infinity;
        break;
      case 'pyromancers-ward':
        s.pyromancersWard = true;
        break;
    }
    return;
  }

  switch (mod.stat) {
    case 'fireDamageMult':
      s.fireDamageMult += mod.addPct / 100;
      break;
    case 'burnDamageMult':
      s.burnDamageMult += mod.addPct / 100;
      break;
    case 'burnDurationMult':
      s.burnDurationMult += mod.addPct / 100;
      break;
    case 'critChance':
      s.critChance += mod.addPct / 100;
      break;
    case 'explosionDamageMult':
      s.explosionDamageMult += mod.addPct / 100;
      break;
    case 'heavyNukeCdMult':
      s.heavyNukeCdMult += mod.addPct / 100;
      break;
    case 'maxSpiritMult':
      s.maxSpiritMult += mod.addPct / 100;
      break;
    case 'wrathGenMult':
      s.wrathGenMult += mod.addPct / 100;
      break;
    case 'detonatorDamagePerStackMult':
      s.detonatorDamagePerStackMult += mod.addPct / 100;
      break;
    case 'maxBurnStacks':
      // Inferno (Infinity) wins regardless of node order.
      if (s.maxBurnStacks !== Infinity) s.maxBurnStacks += mod.addFlat;
      break;
    case 'fireDamagePerEquippedPyro': {
      const bonus = Math.min(mod.addPct * ctx.equippedPyroSkillCount, mod.capPct);
      s.fireDamageMult += bonus / 100;
      break;
    }
  }
}

/**
 * Fold an allocation into final derived stats. Trusts the allocation shape —
 * callers gate writes through `validateAllocation` (passives.ts). Unknown ids
 * are skipped defensively. Inferno's Infinity cap is applied last so it can't
 * be clobbered by a Searing Touch (+1) processed afterwards.
 */
export function computeDerivedStats(
  alloc: PassiveAllocation,
  ctx: StatContext = {}
): DerivedStats {
  const resolved: Required<StatContext> = {
    equippedPyroSkillCount: ctx.equippedPyroSkillCount ?? 6,
    baseBurnStackCap: ctx.baseBurnStackCap ?? DEFAULT_BURN_STACK_CAP,
  };
  const s = baseDerivedStats(resolved.baseBurnStackCap);

  let infernoTaken = false;
  for (const [id, ranks] of Object.entries(alloc)) {
    if (ranks < 1) continue;
    const n = NODE_BY_ID.get(id);
    if (!n) continue;
    for (const mod of n.effects) {
      applyMod(s, mod, resolved);
      if ('kind' in mod && mod.kind === 'keystone' && mod.key === 'inferno') {
        infernoTaken = true;
      }
    }
  }

  // Guarantee Inferno's uncapped Burn regardless of iteration order.
  if (infernoTaken) s.maxBurnStacks = Infinity;

  return s;
}

/** Damage reduction granted by the Pyromancer's Ward keystone. */
export const PYROMANCERS_WARD_REDUCTION = 0.2;

/**
 * Multiplier on incoming damage to the player. Pyromancer's Ward grants -20%
 * while an enemy within 5m carries ≥1 Burn stack. Pure so it can be unit-tested
 * now; the live wiring lands with the player-damage path in S18 (#20).
 */
export function incomingDamageMultiplier(
  stats: DerivedStats,
  enemyBurningNearby: boolean
): number {
  if (stats.pyromancersWard && enemyBurningNearby) {
    return 1 - PYROMANCERS_WARD_REDUCTION;
  }
  return 1;
}

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
import { emptyItemStats, type AggregatedItemStats } from './items.js';

/** Default Burn stack cap before Searing Touch / Inferno modify it. */
export const DEFAULT_BURN_STACK_CAP = 5;

/** Fire damage gained per point of equipped INT (Pyromancy is INT-scaling). */
export const INT_FIRE_DMG_PER_POINT = 0.01;

/** Player base HP before any VIT contribution (S16 pulls HP forward). */
export const BASE_HP = 100;
/** HP gained per point of (equipped) VIT. */
export const HP_PER_VIT = 10;

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
  // ─── Equipped-gear contributions (S13 #15) ───
  /** The four core attributes, summed from equipped items (+ tree/level later). */
  attributes: { str: number; dex: number; int: number; vit: number };
  /** Summed armor mitigation. Character-sheet only until players take damage (S18). */
  armor: number;
  /** Max HP, derived from base + equipped VIT (S16). */
  maxHp: number;
  /** Flat bonus added to weapon (basic-attack) damage. */
  weaponDamageBonus: number;
  /** Character-level Magic Find % (ADR-0005 — never a gear affix). */
  magicFind: number;
}

export interface StatContext {
  /** How many Pyro skills the player has equipped (drives Annihilator). */
  equippedPyroSkillCount?: number;
  /** Override the base Burn cap (defaults to DEFAULT_BURN_STACK_CAP). */
  baseBurnStackCap?: number;
  /** Aggregated flat stats of currently-equipped items (S13/S14). */
  itemStats?: AggregatedItemStats;
  /** Character-level Magic Find % baseline (S14). Not sourced from gear. */
  magicFind?: number;
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
    attributes: { str: 0, dex: 0, int: 0, vit: 0 },
    armor: 0,
    maxHp: BASE_HP,
    weaponDamageBonus: 0,
    magicFind: 0,
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
    itemStats: ctx.itemStats ?? emptyItemStats(),
    magicFind: ctx.magicFind ?? 0,
  };
  const s = baseDerivedStats(resolved.baseBurnStackCap);

  // Equipped gear (S13/S14): surface attributes + armor + weapon damage, map
  // INT into fire damage (Pyromancy scales off INT), and add the +Fire% from
  // affixes. Applied before passives fold so fireDamageMult accumulates
  // additively. Magic Find is a character-level baseline, never from gear.
  const items = resolved.itemStats;
  s.attributes = { str: items.str, dex: items.dex, int: items.int, vit: items.vit };
  s.armor = items.armor;
  s.maxHp = BASE_HP + items.vit * HP_PER_VIT;
  s.weaponDamageBonus = items.weaponDamage;
  s.fireDamageMult += items.int * INT_FIRE_DMG_PER_POINT + items.firePct / 100;
  s.magicFind = resolved.magicFind;

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

// Pyromancy passive tree (S10 #12).
//
// 20 nodes: 2 shared root + 3 archetype paths × 6 (3 boost → 1–2 synergy →
// 1 keystone), per docs/disciplines/pyromancy.md and ADR-0018. Players spend
// a single shared 20-point pool across both equipped disciplines (ADR-0018);
// this file owns the Pyromancy half. Prerequisite gating per ADR-0004:
// path entry requires both roots, then each node requires the previous one.
//
// This module is pure data + pure validators. StatCalculator (stat-calculator.ts)
// folds the `effects` into final character stats.

export type PassivePath = 'root' | 'direct' | 'burn' | 'utility' | 'blade';

export type KeystoneKey = 'flashburn' | 'inferno' | 'pyromancers-ward';

/** A single stat contribution. `addPct` is in percentage points (5 = +5%). */
export type PassiveMod =
  | { stat: 'fireDamageMult'; addPct: number }
  | { stat: 'burnDamageMult'; addPct: number }
  | { stat: 'burnDurationMult'; addPct: number }
  | { stat: 'critChance'; addPct: number }
  | { stat: 'explosionDamageMult'; addPct: number }
  | { stat: 'heavyNukeCdMult'; addPct: number }
  | { stat: 'maxSpiritMult'; addPct: number }
  | { stat: 'wrathGenMult'; addPct: number }
  | { stat: 'detonatorDamagePerStackMult'; addPct: number }
  | { stat: 'maxBurnStacks'; addFlat: number }
  /** Blademaster (S11) — scales weapon (physical) skill damage. */
  | { stat: 'weaponDamageMult'; addPct: number }
  /** Annihilator — +addPct Fire damage per equipped Pyro skill, capped at capPct. */
  | { stat: 'fireDamagePerEquippedPyro'; addPct: number; capPct: number }
  /** Keystone — a build-defining mechanic resolved in StatCalculator. */
  | { kind: 'keystone'; key: KeystoneKey }
  /** A runtime mechanic (proc/buff/CC) consumed by combat systems, not a stat. */
  | { kind: 'flag'; key: string };

export interface PassiveNode {
  id: string;
  name: string;
  path: PassivePath;
  /** 0 = root; 1..6 = depth within an archetype path. */
  tier: number;
  /** Node ids that must be fully allocated before this one. */
  prereq: string[];
  /** Single-rank at alpha. */
  maxRanks: number;
  /** What allocating this node contributes. */
  effects: PassiveMod[];
  /** Short HUD/tooltip description. */
  description: string;
}

export type PassiveAllocation = Record<string, number>;

export const PASSIVE_POOL_SIZE = 20;

const ROOTS = ['embered-soul', 'inner-furnace'];

const node = (
  id: string,
  name: string,
  path: PassivePath,
  tier: number,
  prereq: string[],
  effects: PassiveMod[],
  description: string
): PassiveNode => ({ id, name, path, tier, prereq, maxRanks: 1, effects, description });

export const PASSIVE_NODES: PassiveNode[] = [
  // ─── Root (entry to all paths) ──────────────────────────────
  node('embered-soul', 'Embered Soul', 'root', 0, [], [
    { stat: 'fireDamageMult', addPct: 5 },
    { stat: 'burnDamageMult', addPct: 5 },
  ], '+5% Fire damage, +5% Burn damage.'),
  node('inner-furnace', 'Inner Furnace', 'root', 0, [], [
    { stat: 'maxSpiritMult', addPct: 5 },
    { stat: 'wrathGenMult', addPct: 5 },
  ], '+5% max Spirit, +5% Wrath generation from Pyro skills.'),

  // ─── [D] Direct Burst ───────────────────────────────────────
  node('sharpened-flame', 'Sharpened Flame', 'direct', 1, ROOTS, [
    { stat: 'fireDamageMult', addPct: 8 },
  ], '+8% Fire damage.'),
  node('critical-heat', 'Critical Heat', 'direct', 2, ['sharpened-flame'], [
    { stat: 'critChance', addPct: 5 },
  ], '+5% crit chance with Fire.'),
  node('detonation', 'Detonation', 'direct', 3, ['critical-heat'], [
    { stat: 'explosionDamageMult', addPct: 10 },
  ], '+10% damage to explosion-type skills (Fireball, Combust, Meteor, Cataclysm).'),
  node('overcast', 'Overcast', 'direct', 4, ['detonation'], [
    { stat: 'heavyNukeCdMult', addPct: -10 },
  ], '-10% cooldown on heavy nukes (Meteor, Firestorm).'),
  node('annihilator', 'Annihilator', 'direct', 5, ['overcast'], [
    { stat: 'fireDamagePerEquippedPyro', addPct: 2, capPct: 12 },
  ], '+2% Fire damage per equipped Pyro skill (max +12% at 6/6).'),
  node('flashburn', 'Flashburn', 'direct', 6, ['annihilator'], [
    { kind: 'keystone', key: 'flashburn' },
  ], 'KEYSTONE — Pyro skills no longer apply Burn. All Pyro damage +40%. Crits leave a 1s ground patch.'),

  // ─── [B] Burn Stacker ───────────────────────────────────────
  node('lingering-heat', 'Lingering Heat', 'burn', 1, ROOTS, [
    { stat: 'burnDurationMult', addPct: 20 },
  ], '+20% Burn duration.'),
  node('searing-touch', 'Searing Touch', 'burn', 2, ['lingering-heat'], [
    { stat: 'maxBurnStacks', addFlat: 1 },
  ], '+1 to max Burn stack cap.'),
  node('smoldering-application', 'Smoldering Application', 'burn', 3, ['searing-touch'], [
    { kind: 'flag', key: 'smoldering-application' },
  ], '10% chance Pyro damage applies a bonus Burn stack.'),
  node('combustion-engineer', 'Combustion Engineer', 'burn', 4, ['smoldering-application'], [
    { stat: 'detonatorDamagePerStackMult', addPct: 15 },
  ], '+15% damage per Burn stack consumed by detonators (Combust, Vaporizing Pyroclasm).'),
  node('wildfire', 'Wildfire', 'burn', 5, ['combustion-engineer'], [
    { kind: 'flag', key: 'wildfire' },
  ], 'Enemy dying with 5+ Burn stacks explodes for 50% max HP as Fire damage and spreads 1 Burn nearby.'),
  node('inferno', 'Inferno', 'burn', 6, ['wildfire'], [
    { kind: 'keystone', key: 'inferno' },
  ], 'KEYSTONE — Burn stack cap removed. Stacks beyond default cap deal half damage. Detonators scale linearly.'),

  // ─── [U] Utility / Control ──────────────────────────────────
  node('heat-mirage', 'Heat Mirage', 'utility', 1, ROOTS, [
    { kind: 'flag', key: 'heat-mirage' },
  ], '+10% move speed for 3s after any Pyro skill.'),
  node('smoldering-form', 'Smoldering Form', 'utility', 2, ['heat-mirage'], [
    { kind: 'flag', key: 'smoldering-form' },
  ], 'On hit taken, attacker gets 1 Burn stack (10s cd).'),
  node('pyric-conduit', 'Pyric Conduit', 'utility', 3, ['smoldering-form'], [
    { kind: 'flag', key: 'pyric-conduit' },
  ], 'Wall + Firestorm +25% duration; allies passing through gain +5% Fire damage for 5s.'),
  node('cremator', 'Cremator', 'utility', 4, ['pyric-conduit'], [
    { kind: 'flag', key: 'cremator' },
  ], 'Heat Wave / Ember Step / Wall of Flame interrupt enemy casts in their AoE.'),
  node('phoenix-resilience', 'Phoenix Resilience', 'utility', 5, ['cremator'], [
    { kind: 'flag', key: 'phoenix-resilience' },
  ], 'Once/fight at <20% HP: invulnerable 2s + explode for moderate Fire damage.'),
  node('pyromancers-ward', "Pyromancer's Ward", 'utility', 6, ['phoenix-resilience'], [
    { kind: 'keystone', key: 'pyromancers-ward' },
  ], 'KEYSTONE — -20% damage taken while ≥1 Burn stack is active on an enemy within 5m.'),

  // ─── [Blade] Blademaster (S11 #13) — physical, shares the 20-pt pool ──
  node('honed-edge', 'Honed Edge', 'blade', 1, ROOTS, [
    { stat: 'weaponDamageMult', addPct: 10 },
  ], '+10% weapon (physical) damage.'),
  node('bladedancer', 'Bladedancer', 'blade', 2, ['honed-edge'], [
    { stat: 'critChance', addPct: 5 },
  ], '+5% crit chance with weapon skills.'),
  node('executioner', 'Executioner', 'blade', 3, ['bladedancer'], [
    { stat: 'weaponDamageMult', addPct: 15 },
  ], '+15% weapon damage.'),
  node('whirlwind-master', 'Whirlwind Master', 'blade', 4, ['executioner'], [
    { kind: 'flag', key: 'whirlwind-master' },
  ], 'Cleave hits a wider arc and refunds Spirit on a 2+ target hit.'),
];

const NODE_BY_ID = new Map<string, PassiveNode>(PASSIVE_NODES.map((n) => [n.id, n]));

export function getNode(id: string): PassiveNode | undefined {
  return NODE_BY_ID.get(id);
}

export function totalPointsSpent(alloc: PassiveAllocation): number {
  let sum = 0;
  for (const ranks of Object.values(alloc)) sum += ranks;
  return sum;
}

export type AllocationResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'unknown-node'
        | 'invalid-rank'
        | 'exceeds-max-ranks'
        | 'exceeds-pool'
        | 'prereq-not-met';
    };

/**
 * Validate a complete allocation map. Enforces: known nodes, sane rank counts,
 * the shared 20-point pool, and prerequisite gating (a node may only carry
 * ranks if every prereq is itself allocated). Pool is checked before prereqs
 * so a wildly oversized map fails fast on the cheaper invariant.
 */
export function validateAllocation(alloc: PassiveAllocation): AllocationResult {
  // Structural pass: known nodes, sane rank counts, running total.
  let total = 0;
  for (const [id, ranks] of Object.entries(alloc)) {
    if (!NODE_BY_ID.has(id)) return { ok: false, error: 'unknown-node' };
    if (!Number.isInteger(ranks) || ranks < 1) {
      return { ok: false, error: 'invalid-rank' };
    }
    total += ranks;
  }

  // Global budget before per-node caps: blowing the pool is the headline error.
  if (total > PASSIVE_POOL_SIZE) return { ok: false, error: 'exceeds-pool' };

  for (const [id, ranks] of Object.entries(alloc)) {
    const n = NODE_BY_ID.get(id)!;
    if (ranks > n.maxRanks) return { ok: false, error: 'exceeds-max-ranks' };
  }

  // Prereq gating: every allocated node needs all its prereqs allocated too.
  for (const id of Object.keys(alloc)) {
    const n = NODE_BY_ID.get(id)!;
    for (const p of n.prereq) {
      if (!(alloc[p]! >= 1)) return { ok: false, error: 'prereq-not-met' };
    }
  }

  return { ok: true };
}

/**
 * Ids the player could legally allocate one more rank into right now:
 * prereqs met, not already maxed, and at least one pool point left.
 */
export function allocatableNodes(alloc: PassiveAllocation): string[] {
  if (totalPointsSpent(alloc) >= PASSIVE_POOL_SIZE) return [];
  const out: string[] = [];
  for (const n of PASSIVE_NODES) {
    const current = alloc[n.id] ?? 0;
    if (current >= n.maxRanks) continue;
    const prereqMet = n.prereq.every((p) => (alloc[p] ?? 0) >= 1);
    if (prereqMet) out.push(n.id);
  }
  return out;
}

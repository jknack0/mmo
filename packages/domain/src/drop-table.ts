// DropTable (S13 #15, extended S14 #16) — pure mob→loot resolution. rollDrop
// (white base only) remains; rollItemDrop layers ADR-0005 rarity + affixes on
// top. All randomness is injected (`roll`/`rng`) so the tables stay pure and
// deterministically testable.

import {
  STAT_AFFIXES,
  SKILL_AFFIXES,
  rollAffix,
  type Rarity,
  type RolledAffix,
} from './affixes.js';
import { UNIQUE_BASE_IDS, UNIQUE_AFFIXES } from './items.js';

export interface DropTableEntry {
  /** Probability in [0,1] that a kill of this mob kind drops anything. */
  chance: number;
  /** White base ids that can drop, selected uniformly when a drop occurs. */
  pool: string[];
}

export const DROP_TABLES: Record<string, DropTableEntry> = {
  skeleton: {
    chance: 0.35,
    pool: [
      'rusty-sword',
      'apprentice-wand',
      'leather-cap',
      'leather-vest',
      'leather-boots',
      'copper-ring',
      'copper-amulet',
    ],
  },
};

/**
 * Resolve a drop for `mobKind` given a uniform `roll` in [0,1). Returns the
 * dropped base id, or null for no drop / unknown kind. A drop occurs when
 * `roll < chance`; the in-band fraction `roll/chance` then indexes the pool,
 * so the full [0,chance) range maps evenly across all entries.
 */
export function rollDrop(mobKind: string, roll: number): string | null {
  const table = DROP_TABLES[mobKind];
  if (!table) return null;
  if (roll >= table.chance) return null;
  const frac = roll / table.chance; // 0 ≤ frac < 1
  const idx = Math.min(table.pool.length - 1, Math.floor(frac * table.pool.length));
  return table.pool[idx]!;
}

// ─── S14: rarity + affix roll ─────────────────────────────────

/** Base rarity weights (no Magic Find). Sum need not be 1 — normalised below. */
const BASE_RARITY_WEIGHTS: Record<Rarity, number> = {
  white: 0.6,
  blue: 0.28,
  yellow: 0.105,
  gold: 0.015,
};

/** Fraction of affixes that are stat-flavored (ADR-0005 ~60/40). */
export const STAT_AFFIX_RATIO = 0.6;

/**
 * Pick a rarity from a uniform `r01`, biased upward by `magicFind` (a
 * character-level percentage per ADR-0005; gear never carries it). MF scales
 * the non-white weights by (1 + magicFind/100) before normalising, so higher
 * MF pushes probability mass toward blue/yellow/gold.
 */
export function rollRarity(r01: number, magicFind = 0): Rarity {
  const mf = 1 + Math.max(0, magicFind) / 100;
  const weights: Record<Rarity, number> = {
    white: BASE_RARITY_WEIGHTS.white,
    blue: BASE_RARITY_WEIGHTS.blue * mf,
    yellow: BASE_RARITY_WEIGHTS.yellow * mf,
    gold: BASE_RARITY_WEIGHTS.gold * mf,
  };
  const order: Rarity[] = ['white', 'blue', 'yellow', 'gold'];
  const total = order.reduce((s, r) => s + weights[r], 0);
  let acc = 0;
  const target = r01 * total;
  for (const r of order) {
    acc += weights[r];
    if (target < acc) return r;
  }
  return 'gold';
}

/** Affix count for a non-unique rarity, from a uniform `r01`. */
export function affixCountForRarity(rarity: Rarity, r01: number): number {
  switch (rarity) {
    case 'blue': return r01 < 0.5 ? 1 : 2;
    case 'yellow': return 3 + Math.min(2, Math.floor(r01 * 3)); // 3..5
    default: return 0; // white (gold handled via fixed uniques)
  }
}

/** Roll N distinct affixes with a ~60/40 stat/skill split, falling back across
 *  kinds when one pool is exhausted. Each affix consumes three rng draws
 *  (kind, template, value). */
function rollAffixes(count: number, rng: () => number): RolledAffix[] {
  const used = new Set<string>();
  const out: RolledAffix[] = [];
  for (let i = 0; i < count; i++) {
    let pool = rng() < STAT_AFFIX_RATIO ? STAT_AFFIXES : SKILL_AFFIXES;
    if (pool.every((t) => used.has(t.id))) {
      pool = pool === STAT_AFFIXES ? SKILL_AFFIXES : STAT_AFFIXES;
    }
    if (pool.every((t) => used.has(t.id))) break; // both kinds exhausted
    const start = Math.floor(rng() * pool.length);
    for (let k = 0; k < pool.length; k++) {
      const t = pool[(start + k) % pool.length]!;
      if (!used.has(t.id)) {
        used.add(t.id);
        out.push(rollAffix(t, rng()));
        break;
      }
    }
  }
  return out;
}

export interface ItemDrop {
  baseId: string;
  affixes: RolledAffix[];
}

/**
 * Full loot roll for a kill: drop chance → rarity (Magic-Find-biased) → base +
 * affixes. Gold yields a fixed-stat unique. Returns null for no drop / unknown
 * mob. `rng` is an injected uniform source so the whole roll is reproducible.
 */
export function rollItemDrop(
  mobKind: string,
  rng: () => number,
  magicFind = 0
): ItemDrop | null {
  const table = DROP_TABLES[mobKind];
  if (!table) return null;
  if (rng() >= table.chance) return null;

  const rarity = rollRarity(rng(), magicFind);

  if (rarity === 'gold') {
    const baseId = UNIQUE_BASE_IDS[Math.floor(rng() * UNIQUE_BASE_IDS.length)]!;
    return { baseId, affixes: (UNIQUE_AFFIXES[baseId] ?? []).map((a) => ({ ...a })) };
  }

  const baseId = table.pool[Math.floor(rng() * table.pool.length)]!;
  const count = affixCountForRarity(rarity, rng());
  return { baseId, affixes: rollAffixes(count, rng) };
}

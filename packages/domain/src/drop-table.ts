// DropTable (S13 #15) — pure mob→loot resolution. White-tier only at this
// slice (ADR-0005). The channel rolls a single uniform value in [0,1) per kill;
// keeping it a parameter (rather than calling Math.random inside) makes the
// table deterministically testable and keeps the module pure.

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

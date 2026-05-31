// @mmo/domain — shared domain modules.
//
// Will host (per PRD docs/prd/alpha-vertical-slice.md):
//   - DisciplineSchema (S08 #10)
//   - ItemSchema      (S13 #15)
//   - StatCalculator  (S10 #12)
//   - DropTable       (S13 #15)
//   - TappingService  (S15 #17)
//
// S10 (#12): Pyromancy passive tree + StatCalculator.
export * from './passives.js';
export * from './stat-calculator.js';
// S13 (#15): items + drops.
export * from './items.js';
export * from './drop-table.js';
// S14 (#16): affixes + rarity.
export * from './affixes.js';
// S15 (#17): refinement / tapping.
export * from './refinement.js';
// S16 (#18): consumables + vendor economy.
export * from './consumables.js';
// S17 (#19): zone definitions + portals + NPCs.
export * from './zones.js';
// S18 (#20): death + respawn economy.
export * from './respawn.js';

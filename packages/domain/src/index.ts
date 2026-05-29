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

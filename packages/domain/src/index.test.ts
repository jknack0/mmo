import { describe, it, expect } from 'vitest';

// Smoke test — confirms the Vitest pipeline runs in CI.
// Real domain tests arrive with the modules they cover (S08, S10, S13, S15).
describe('@mmo/domain', () => {
  it('package smoke test', () => {
    expect(1 + 1).toBe(2);
  });
});

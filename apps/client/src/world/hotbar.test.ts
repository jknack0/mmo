import { describe, it, expect } from 'vitest';
import { HOTBAR, canCast, slotState, hotbarView } from './hotbar.js';

const spark = HOTBAR.find((s) => s.skillId === 'spark')!;        // 350ms, 8 spirit
const pyroclasm = HOTBAR.find((s) => s.skillId === 'pyroclasm')!; // 5000ms, 100 wrath

describe('hotbar cooldown + castability (pure)', () => {
  it('maps the 6 alpha hotkeys to skills with cooldown + cost + resource', () => {
    expect(HOTBAR.map((s) => s.key)).toEqual(['q', 'w', 'e', 'r', 'a', 's']);
    expect(spark).toMatchObject({ cooldownMs: 350, cost: 8, resource: 'spirit' });
    expect(pyroclasm).toMatchObject({ cooldownMs: 5000, cost: 100, resource: 'wrath' });
  });

  it('canCast is true only when off cooldown AND the resource covers the cost', () => {
    const now = 1000;
    // off-cd (cdEndsAt in the past), plenty of spirit → castable
    expect(canCast(spark, 0, 50, 0, now)).toBe(true);
    // on cooldown → not castable even with spirit
    expect(canCast(spark, now + 200, 50, 0, now)).toBe(false);
    // off-cd but not enough spirit → not castable
    expect(canCast(spark, 0, 5, 0, now)).toBe(false);
  });

  it('gates a Wrath skill on wrath, not spirit', () => {
    const now = 1000;
    expect(canCast(pyroclasm, 0, 999, 100, now)).toBe(true);   // full wrath
    expect(canCast(pyroclasm, 0, 999, 40, now)).toBe(false);   // spirit irrelevant
  });
});

describe('slotState (render model for one slot)', () => {
  it('a ready, affordable slot is not cooling and not disabled', () => {
    const s = slotState(spark, 0, 50, 0, 1000);
    expect(s).toMatchObject({ skillId: 'spark', cdFrac: 0, cdSeconds: 0, cooling: false, disabled: false });
  });

  it('mid-cooldown reports a 0..1 sweep fraction, countdown seconds, and disables the slot', () => {
    // spark cd 350ms; 175ms remaining → half swept
    const s = slotState(spark, 1175, 50, 0, 1000);
    expect(s.cooling).toBe(true);
    expect(s.disabled).toBe(true);
    expect(s.cdFrac).toBeCloseTo(0.5, 2);
    expect(s.cdSeconds).toBe(1); // ceil(175ms) → 1s
  });

  it('disables an off-cooldown slot the player cannot afford', () => {
    const s = slotState(spark, 0, 5, 0, 1000); // 5 < 8 spirit
    expect(s.cooling).toBe(false);
    expect(s.disabled).toBe(true);
  });
});

describe('hotbarView (full render array for the HUD)', () => {
  it('yields all 6 slots in keybind order with static + dynamic fields', () => {
    const view = hotbarView(new Map(), new Map(), 100, 100, 1000);
    expect(view).toHaveLength(6);
    expect(view.map((v) => v.skillId)).toEqual(HOTBAR.map((s) => s.skillId));
    expect(view[0]).toMatchObject({ key: 'q', cost: 8, icon: 0, deny: false, disabled: false });
  });

  it('reflects per-slot cooldown + a recent deny flash', () => {
    const cd = new Map([['fireball', 1500]]);  // fireball on cd until t=1500
    const deny = new Map([['meteor', 900]]);   // meteor denied at t=900
    const view = hotbarView(cd, deny, 100, 100, 1000);
    const fb = view.find((v) => v.skillId === 'fireball')!;
    const mt = view.find((v) => v.skillId === 'meteor')!;
    expect(fb.cooling).toBe(true);
    expect(fb.disabled).toBe(true);
    expect(mt.deny).toBe(true);              // 1000 - 900 = 100ms < 300ms window
    expect(view.find((v) => v.skillId === 'spark')!.deny).toBe(false);
  });
});

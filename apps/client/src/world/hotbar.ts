// Hotbar model (pure). The 6-key alpha loadout plus the cooldown/castability
// math the HUD renders. Cooldowns are client-predicted from each skill's known
// duration — the server stays authoritative and rejects a cast that's actually
// on cd, but the bar reflects state instantly so a press never silently no-ops.
//
// Pure + DOM-free so it unit-tests without Pixi/Solid. The cooldown/cost values
// mirror SKILL_DEFS on the channel; kept here as a small table for the alpha
// hotbar (unify into @mmo/domain when bindings become configurable, S09 #11).

export type SkillResource = 'spirit' | 'wrath';

export interface HotbarSkill {
  /** Keyboard key that triggers this slot. */
  key: string;
  skillId: string;
  /** Cooldown in ms (client-predicted sweep duration). */
  cooldownMs: number;
  /** Resource cost. */
  cost: number;
  resource: SkillResource;
  /** Frame index into icon_skills.png. */
  icon: number;
}

export const HOTBAR: HotbarSkill[] = [
  { key: 'q', skillId: 'spark', cooldownMs: 350, cost: 8, resource: 'spirit', icon: 0 },
  { key: 'w', skillId: 'cinder-spray', cooldownMs: 3_000, cost: 12, resource: 'spirit', icon: 1 },
  { key: 'e', skillId: 'fireball', cooldownMs: 8_000, cost: 24, resource: 'spirit', icon: 2 },
  { key: 'r', skillId: 'pyroclasm', cooldownMs: 5_000, cost: 100, resource: 'wrath', icon: 3 },
  { key: 'a', skillId: 'combust', cooldownMs: 12_000, cost: 30, resource: 'spirit', icon: 4 },
  { key: 's', skillId: 'meteor', cooldownMs: 30_000, cost: 45, resource: 'spirit', icon: 5 },
];

/** How much of the skill's resource the player currently holds. */
export function resourceAmount(s: HotbarSkill, spirit: number, wrath: number): number {
  return s.resource === 'wrath' ? wrath : spirit;
}

/** True when the skill is off cooldown and the player can pay its cost. */
export function canCast(
  s: HotbarSkill,
  cdEndsAt: number,
  spirit: number,
  wrath: number,
  now: number
): boolean {
  if (cdEndsAt > now) return false;
  return resourceAmount(s, spirit, wrath) >= s.cost;
}

/** Render model for one slot: cooldown sweep + countdown + disabled flag. */
export interface SlotState {
  skillId: string;
  /** 0..1 remaining-cooldown fraction, for the `--cd` radial wipe. */
  cdFrac: number;
  /** Whole seconds left on cooldown, 0 when ready. */
  cdSeconds: number;
  cooling: boolean;
  /** Greyed out: on cooldown or unaffordable. */
  disabled: boolean;
}

export function slotState(
  s: HotbarSkill,
  cdEndsAt: number,
  spirit: number,
  wrath: number,
  now: number
): SlotState {
  const rem = Math.max(0, cdEndsAt - now);
  const cooling = rem > 0;
  const cdFrac = cooling && s.cooldownMs > 0 ? Math.min(1, rem / s.cooldownMs) : 0;
  const affordable = resourceAmount(s, spirit, wrath) >= s.cost;
  return {
    skillId: s.skillId,
    cdFrac,
    cdSeconds: cooling ? Math.ceil(rem / 1000) : 0,
    cooling,
    disabled: cooling || !affordable,
  };
}

/** How long the deny shake stays lit after a rejected press (ms). */
export const DENY_MS = 300;

/** One slot's full render model: dynamic state + the static label fields. */
export interface HotbarSlotView extends SlotState {
  key: string;
  cost: number;
  resource: SkillResource;
  icon: number;
  /** A press was rejected within the last DENY_MS — play the deny shake. */
  deny: boolean;
}

/**
 * Assemble the whole hotbar render array. `cdEndsAt`/`deniedAt` are keyed by
 * skillId (ms timestamps); missing keys mean ready / no recent deny. Pure so
 * the renderer just maps over the result.
 */
export function hotbarView(
  cdEndsAt: Map<string, number>,
  deniedAt: Map<string, number>,
  spirit: number,
  wrath: number,
  now: number
): HotbarSlotView[] {
  return HOTBAR.map((s) => ({
    ...slotState(s, cdEndsAt.get(s.skillId) ?? 0, spirit, wrath, now),
    key: s.key,
    cost: s.cost,
    resource: s.resource,
    icon: s.icon,
    deny: now - (deniedAt.get(s.skillId) ?? -Infinity) < DENY_MS,
  }));
}

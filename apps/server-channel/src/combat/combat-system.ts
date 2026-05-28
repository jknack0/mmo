// Server-authoritative combat. Per-skill cooldown timestamp map (per
// PROTOTYPE_NOTES.md lesson #2 — generalised from the spike's global
// attack-rate clamp), range validation, damage application, sticky
// attack-target FSM (per PROTOTYPE_NOTES.md lesson #1), Spirit/Wrath
// resource gating (ADR-0010).

import type { PlayerId, EntityId, SkillId, DamageEvent } from '@mmo/protocol';
import {
  damageMob,
  applyBurnStacks,
  detonateBurns,
  type ZoneState,
  type ServerPlayer,
} from '../zone/zone-state.js';
import {
  onDamageDealt,
  spendSpirit,
  spendWrath,
} from '../resources/resource-system.js';
import { applyTripod, PYROMANCY_TRIPODS } from './tripods.js';

export interface SkillDef {
  id: SkillId;
  cooldownMs: number;
  rangeTiles: number;
  damage: number;
  /** ADR-0010: most skills cost Spirit; a few elite skills cost Wrath. */
  spiritCost: number;
  wrathCost: number;
  /** Burn stacks applied to the target on hit (Pyromancy DoT). */
  burnStacksApplied?: number;
  /** When true, after the hit lands the skill also detonates Burn stacks. */
  detonatesBurn?: boolean;
  /** Bonus per consumed Burn stack when detonating (Combust + Pyroclasm). */
  detonateBonusPerStack?: number;
  /** A short, player-facing name for the HUD. */
  label?: string;
}

/**
 * Mutable registry so tests can introduce additional skills without
 * rewiring the import graph. Real builds load these from a data file in
 * `packages/domain/DisciplineSchema` (S08 #10).
 *
 * basic-attack — free right-mouse weapon attack, the spammable filler.
 * spark        — Pyromancy first skill: cheap, fast, projectile.
 * pyroclasm    — Pyromancy elite: massive damage, full-Wrath gate.
 */
export const SKILL_DEFS: Record<SkillId, SkillDef> = {
  // Universal weapon attack.
  'basic-attack': {
    id: 'basic-attack', label: 'Attack',
    cooldownMs: 500, rangeTiles: 2, damage: 12,
    spiritCost: 0, wrathCost: 0,
  },

  // ─── Pyromancy — Mobility ───────────────────────────────────
  'ember-step': {
    id: 'ember-step', label: 'Ember Step',
    cooldownMs: 8_000, rangeTiles: 5, damage: 6,
    spiritCost: 4, wrathCost: 0,
    burnStacksApplied: 1,
  },

  // ─── Pyromancy — Spammable filler ───────────────────────────
  spark: {
    id: 'spark', label: 'Spark',
    cooldownMs: 350, rangeTiles: 8, damage: 10,
    spiritCost: 8, wrathCost: 0,
  },
  'cinder-spray': {
    id: 'cinder-spray', label: 'Cinder Spray',
    cooldownMs: 3_000, rangeTiles: 4, damage: 8,
    spiritCost: 12, wrathCost: 0,
    burnStacksApplied: 1,
  },
  'heat-wave': {
    id: 'heat-wave', label: 'Heat Wave',
    cooldownMs: 5_000, rangeTiles: 3, damage: 14,
    spiritCost: 16, wrathCost: 0,
  },

  // ─── Pyromancy — Mid-cd burst ──────────────────────────────
  fireball: {
    id: 'fireball', label: 'Fireball',
    cooldownMs: 8_000, rangeTiles: 7, damage: 30,
    spiritCost: 24, wrathCost: 0,
  },
  'flame-lance': {
    id: 'flame-lance', label: 'Flame Lance',
    cooldownMs: 10_000, rangeTiles: 10, damage: 38,
    spiritCost: 28, wrathCost: 0,
  },
  combust: {
    id: 'combust', label: 'Combust',
    cooldownMs: 12_000, rangeTiles: 6, damage: 18,
    spiritCost: 30, wrathCost: 0,
    detonatesBurn: true,
    detonateBonusPerStack: 10,
  },

  // ─── Pyromancy — Heavy nuke ────────────────────────────────
  meteor: {
    id: 'meteor', label: 'Meteor',
    cooldownMs: 30_000, rangeTiles: 8, damage: 90,
    spiritCost: 45, wrathCost: 0,
  },
  firestorm: {
    id: 'firestorm', label: 'Firestorm',
    cooldownMs: 35_000, rangeTiles: 6, damage: 70,
    spiritCost: 40, wrathCost: 0,
    burnStacksApplied: 2,
  },

  // ─── Pyromancy — Utility ────────────────────────────────────
  'wall-of-flame': {
    id: 'wall-of-flame', label: 'Wall of Flame',
    cooldownMs: 25_000, rangeTiles: 5, damage: 20,
    spiritCost: 20, wrathCost: 0,
    burnStacksApplied: 1,
  },

  // ─── Pyromancy — Elite (Wrath) ─────────────────────────────
  pyroclasm: {
    id: 'pyroclasm', label: 'Pyroclasm',
    cooldownMs: 5_000, rangeTiles: 4, damage: 80,
    spiritCost: 0, wrathCost: 100,
    detonatesBurn: true,
    detonateBonusPerStack: 15,
  },
  cataclysm: {
    id: 'cataclysm', label: 'Cataclysm',
    cooldownMs: 60_000, rangeTiles: 10, damage: 150,
    spiritCost: 0, wrathCost: 100,
    burnStacksApplied: 3,
  },
};

export type AttackOutcome =
  | { ok: true; damage: number; fatal: boolean }
  | {
      ok: false;
      reason:
        | 'unknown-skill'
        | 'attacker-missing'
        | 'target-missing'
        | 'target-dead'
        | 'out-of-range'
        | 'on-cooldown'
        | 'no-spirit'
        | 'no-wrath';
    };

function tileDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Resolve the player's effective SkillDef by applying any tripod
 * selection on top of the base definition.
 */
function resolveSkill(player: ServerPlayer, skillId: SkillId): SkillDef | undefined {
  const base = SKILL_DEFS[skillId];
  if (!base) return undefined;
  const tripod = PYROMANCY_TRIPODS[skillId];
  const sel = player.tripods?.[skillId];
  if (!tripod || !sel) return base;
  return applyTripod(base, sel, tripod);
}

export function attemptAttack(
  zone: ZoneState,
  attackerId: PlayerId,
  targetId: EntityId,
  skillId: SkillId,
  nowMs: number
): AttackOutcome {
  const attacker = zone.players.get(attackerId);
  if (!attacker) return { ok: false, reason: 'attacker-missing' };
  const def = resolveSkill(attacker, skillId);
  if (!def) return { ok: false, reason: 'unknown-skill' };

  const target = zone.mobs.get(targetId);
  if (!target) return { ok: false, reason: 'target-missing' };
  if (!target.alive) return { ok: false, reason: 'target-dead' };

  if (tileDistance(attacker.pos, target.pos) > def.rangeTiles) {
    return { ok: false, reason: 'out-of-range' };
  }

  const expires = attacker.cooldowns.get(skillId) ?? 0;
  if (nowMs < expires) return { ok: false, reason: 'on-cooldown' };

  if (def.spiritCost > 0 && attacker.resources.spirit < def.spiritCost) {
    return { ok: false, reason: 'no-spirit' };
  }
  if (def.wrathCost > 0 && attacker.resources.wrath < def.wrathCost) {
    return { ok: false, reason: 'no-wrath' };
  }
  if (def.spiritCost > 0) spendSpirit(attacker.resources, def.spiritCost);
  if (def.wrathCost > 0) spendWrath(attacker.resources, def.wrathCost);

  // Detonate stacks (Combust / Vaporizing Pyroclasm) BEFORE the base hit so
  // the killing blow can be either the bonus or the base — but resolution
  // still happens through damageMob for a single fatal check.
  let bonus = 0;
  if (def.detonatesBurn && def.detonateBonusPerStack) {
    bonus = detonateBurns(zone, targetId, def.detonateBonusPerStack);
  }
  const total = def.damage + bonus;
  const { fatal, applied } = damageMob(zone, targetId, total, nowMs);
  if (def.burnStacksApplied && def.burnStacksApplied > 0 && !fatal) {
    applyBurnStacks(zone, targetId, def.burnStacksApplied, attackerId, nowMs);
  }
  attacker.cooldowns.set(skillId, nowMs + def.cooldownMs);
  onDamageDealt(attacker.resources, applied, nowMs);
  return { ok: true, damage: applied, fatal };
}

// ─── Sticky-attack-target FSM ─────────────────────────────────

/**
 * Lock the player onto a target. Returns false if the skill is unknown,
 * the player does not exist, or the mob is missing/dead. The actual
 * chasing + attacking is driven by `advancePlayerCombat` each tick.
 */
export function engageTarget(
  zone: ZoneState,
  playerId: PlayerId,
  targetId: EntityId,
  skillId: SkillId
): boolean {
  if (!SKILL_DEFS[skillId]) return false;
  const player = zone.players.get(playerId);
  if (!player) return false;
  const mob = zone.mobs.get(targetId);
  if (!mob || !mob.alive) return false;
  player.attackState = { kind: 'chasing', targetId, skillId };
  return true;
}

export function disengage(zone: ZoneState, playerId: PlayerId): void {
  const player = zone.players.get(playerId);
  if (!player) return;
  player.attackState = { kind: 'idle' };
}

/**
 * Drive one tick of the player's attack FSM. Returns any Damage events
 * fired during this tick (zero or one for now — multi-target skills can
 * return more later).
 */
export function advancePlayerCombat(
  zone: ZoneState,
  playerId: PlayerId,
  nowMs: number
): DamageEvent[] {
  const player = zone.players.get(playerId);
  if (!player) return [];
  const state = player.attackState;
  if (state.kind === 'idle') return [];

  const skill = resolveSkill(player, state.skillId);
  if (!skill) {
    player.attackState = { kind: 'idle' };
    return [];
  }

  const mob = zone.mobs.get(state.targetId);
  if (!mob || !mob.alive) {
    player.attackState = { kind: 'idle' };
    if (player.target) player.target = null;
    return [];
  }

  const dist = tileDistance(player.pos, mob.pos);

  if (dist > skill.rangeTiles) {
    player.attackState = {
      kind: 'chasing',
      targetId: state.targetId,
      skillId: state.skillId,
    };
    player.target = { ...mob.pos };
    return [];
  }

  // In range — lock state, stand still.
  player.attackState = {
    kind: 'in-range-attacking',
    targetId: state.targetId,
    skillId: state.skillId,
  };
  player.target = null;

  const expires = player.cooldowns.get(state.skillId) ?? 0;
  if (nowMs < expires) return [];

  // Resource gate. If the player can't pay, skip this tick — they'll
  // try again next tick once regen catches up.
  if (skill.spiritCost > 0 && player.resources.spirit < skill.spiritCost) return [];
  if (skill.wrathCost > 0 && player.resources.wrath < skill.wrathCost) return [];
  if (skill.spiritCost > 0) spendSpirit(player.resources, skill.spiritCost);
  if (skill.wrathCost > 0) spendWrath(player.resources, skill.wrathCost);

  let bonus = 0;
  if (skill.detonatesBurn && skill.detonateBonusPerStack) {
    bonus = detonateBurns(zone, state.targetId, skill.detonateBonusPerStack);
  }
  const total = skill.damage + bonus;
  const { fatal, applied } = damageMob(zone, state.targetId, total, nowMs);
  if (skill.burnStacksApplied && skill.burnStacksApplied > 0 && !fatal) {
    applyBurnStacks(zone, state.targetId, skill.burnStacksApplied, playerId, nowMs);
  }
  player.cooldowns.set(state.skillId, nowMs + skill.cooldownMs);
  onDamageDealt(player.resources, applied, nowMs);
  return [
    {
      targetId: state.targetId,
      attackerId: playerId,
      amount: applied,
      fatal,
    },
  ];
}

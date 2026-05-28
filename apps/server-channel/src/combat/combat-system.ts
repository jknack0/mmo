// Server-authoritative combat. Per-skill cooldown timestamp map (per
// PROTOTYPE_NOTES.md lesson #2 — generalised from the spike's global
// attack-rate clamp), range validation, damage application, sticky
// attack-target FSM (per PROTOTYPE_NOTES.md lesson #1), Spirit/Wrath
// resource gating (ADR-0010).

import type { PlayerId, EntityId, SkillId, DamageEvent } from '@mmo/protocol';
import { damageMob, type ZoneState } from '../zone/zone-state.js';
import {
  onDamageDealt,
  spendSpirit,
  spendWrath,
} from '../resources/resource-system.js';

export interface SkillDef {
  id: SkillId;
  cooldownMs: number;
  rangeTiles: number;
  damage: number;
  /** ADR-0010: most skills cost Spirit; a few elite skills cost Wrath. */
  spiritCost: number;
  wrathCost: number;
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
  'basic-attack': {
    id: 'basic-attack',
    cooldownMs: 500,
    rangeTiles: 2,
    damage: 12,
    spiritCost: 0,
    wrathCost: 0,
  },
  spark: {
    id: 'spark',
    cooldownMs: 350,
    rangeTiles: 8,
    damage: 10,
    spiritCost: 8,
    wrathCost: 0,
  },
  pyroclasm: {
    id: 'pyroclasm',
    cooldownMs: 5_000,
    rangeTiles: 4,
    damage: 80,
    spiritCost: 0,
    wrathCost: 100,
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

export function attemptAttack(
  zone: ZoneState,
  attackerId: PlayerId,
  targetId: EntityId,
  skillId: SkillId,
  nowMs: number
): AttackOutcome {
  const def = SKILL_DEFS[skillId];
  if (!def) return { ok: false, reason: 'unknown-skill' };

  const attacker = zone.players.get(attackerId);
  if (!attacker) return { ok: false, reason: 'attacker-missing' };

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

  const { fatal, applied } = damageMob(zone, targetId, def.damage, nowMs);
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

  const skill = SKILL_DEFS[state.skillId];
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

  const { fatal, applied } = damageMob(zone, state.targetId, skill.damage, nowMs);
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

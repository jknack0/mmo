// Server-authoritative combat. Per-skill cooldown timestamp map (per
// PROTOTYPE_NOTES.md lesson #2 — generalised from the spike's global
// attack-rate clamp), range validation, damage application, sticky
// attack-target FSM (per PROTOTYPE_NOTES.md lesson #1).

import type { PlayerId, EntityId, SkillId, DamageEvent } from '@mmo/protocol';
import { damageMob, type ZoneState } from '../zone/zone-state.js';

export interface SkillDef {
  id: SkillId;
  cooldownMs: number;
  rangeTiles: number;
  damage: number;
}

/**
 * Mutable registry so tests can introduce additional skills without
 * rewiring the import graph. Real builds load these from a data file in
 * `packages/domain/DisciplineSchema` (S08 #10).
 */
export const SKILL_DEFS: Record<SkillId, SkillDef> = {
  'basic-attack': {
    id: 'basic-attack',
    cooldownMs: 500,
    rangeTiles: 2,
    damage: 12,
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
        | 'on-cooldown';
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

  const { fatal, applied } = damageMob(zone, targetId, def.damage, nowMs);
  attacker.cooldowns.set(skillId, nowMs + def.cooldownMs);
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
 *
 * Transitions:
 *   idle: no-op
 *   chasing target alive in range: → in-range-attacking, stand still
 *   chasing target alive out of range: stay chasing, set player.target = mob.pos
 *   in-range-attacking target alive out of range: → chasing
 *   in-range-attacking + cooldown ready: fire skill, stay in-range-attacking
 *   target dead or missing: → idle, clear chase target
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

  const { fatal, applied } = damageMob(zone, state.targetId, skill.damage, nowMs);
  player.cooldowns.set(state.skillId, nowMs + skill.cooldownMs);
  return [
    {
      targetId: state.targetId,
      attackerId: playerId,
      amount: applied,
      fatal,
    },
  ];
}

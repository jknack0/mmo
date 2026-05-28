// Server-authoritative combat. Per-skill cooldown timestamp map (per
// PROTOTYPE_NOTES.md lesson #2 — generalised from the spike's global
// attack-rate clamp), range validation, damage application.

import type { PlayerId, EntityId, SkillId } from '@mmo/protocol';
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

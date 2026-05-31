// Disciplines + 2-discipline mixing (S11 #13, ADR-0004/0018). The alpha ships
// two disciplines — Pyromancy (full) and Blademaster (reduced stub) — to prove
// the mixing system: a player equips any 2 of the available disciplines and
// free-picks any HOTBAR_SIZE skills from the union of their pools. Nothing here
// hardcodes Pyromancy; combat keys off skill flags, not discipline identity.

export const PYROMANCY = 'pyromancy';
export const BLADEMASTER = 'blademaster';

export interface DisciplineDef {
  id: string;
  name: string;
  /** Skill ids this discipline grants (basic-attack is universal, not listed). */
  skillIds: string[];
}

export const DISCIPLINES: Record<string, DisciplineDef> = {
  [PYROMANCY]: {
    id: PYROMANCY,
    name: 'Pyromancy',
    skillIds: [
      'ember-step', 'spark', 'cinder-spray', 'heat-wave', 'fireball', 'flame-lance',
      'combust', 'meteor', 'firestorm', 'wall-of-flame', 'pyroclasm', 'cataclysm',
    ],
  },
  [BLADEMASTER]: {
    id: BLADEMASTER,
    name: 'Blademaster',
    skillIds: ['slash', 'blade-dash', 'cleave', 'decisive-strike'],
  },
};

export const ALL_DISCIPLINE_IDS = Object.keys(DISCIPLINES);

/** Concurrent equipped disciplines (ADR-0004 two-discipline mixing). */
export const MAX_EQUIPPED_DISCIPLINES = 2;

/** Hotbar slots — free-pick from the equipped disciplines' pools. */
export const HOTBAR_SIZE = 6;

/** Gold cost to change equipped disciplines (placeholder; also clears passives). */
export const DISCIPLINE_SWITCH_COST = 50;

export function getDiscipline(id: string): DisciplineDef | undefined {
  return DISCIPLINES[id];
}

/** Every selectable skill id across all disciplines (the "of 24" pool). */
export function allSkillIds(): string[] {
  return ALL_DISCIPLINE_IDS.flatMap((d) => DISCIPLINES[d]!.skillIds);
}

/** The skills available to a set of equipped disciplines (union of pools). */
export function skillsForDisciplines(equipped: string[]): string[] {
  const out: string[] = [];
  for (const id of equipped) {
    const d = DISCIPLINES[id];
    if (d) out.push(...d.skillIds);
  }
  return out;
}

/** A valid equip is ≤2 distinct, known disciplines. */
export function validateEquippedDisciplines(ids: unknown): ids is string[] {
  if (!Array.isArray(ids)) return false;
  if (ids.length > MAX_EQUIPPED_DISCIPLINES) return false;
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || !DISCIPLINES[id] || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/**
 * Learned-equip gate (S12 #14): a player may only equip disciplines they have
 * unlocked via the trainer quest. `learned` is the character's `disciplines_learned`
 * set. Returns false if any equipped id is not yet learned. Combine with
 * `validateEquippedDisciplines` for shape + the learned check for entitlement.
 */
export function validateLearnedEquip(equipped: string[], learned: string[]): boolean {
  const known = new Set(learned);
  return equipped.every((id) => known.has(id));
}

/**
 * A valid hotbar is ≤HOTBAR_SIZE distinct skills, each drawn from the equipped
 * disciplines' pools (free distribution across the two disciplines).
 */
export function validateHotbar(skillIds: unknown, equipped: string[]): skillIds is string[] {
  if (!Array.isArray(skillIds)) return false;
  if (skillIds.length > HOTBAR_SIZE) return false;
  const pool = new Set(skillsForDisciplines(equipped));
  const seen = new Set<string>();
  for (const s of skillIds) {
    if (typeof s !== 'string' || !pool.has(s) || seen.has(s)) return false;
    seen.add(s);
  }
  return true;
}

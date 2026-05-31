import { describe, it, expect } from 'vitest';
import {
  DISCIPLINES,
  PYROMANCY,
  BLADEMASTER,
  allSkillIds,
  skillsForDisciplines,
  validateEquippedDisciplines,
  validateLearnedEquip,
  validateHotbar,
  MAX_EQUIPPED_DISCIPLINES,
  HOTBAR_SIZE,
} from './disciplines.js';

describe('disciplines', () => {
  it('ships Pyromancy (full) + Blademaster (4-skill stub)', () => {
    expect(DISCIPLINES[PYROMANCY]!.skillIds.length).toBe(12);
    expect(DISCIPLINES[BLADEMASTER]!.skillIds).toEqual(['slash', 'blade-dash', 'cleave', 'decisive-strike']);
  });

  it('allSkillIds is the union of every discipline pool', () => {
    expect(allSkillIds()).toEqual([...DISCIPLINES[PYROMANCY]!.skillIds, ...DISCIPLINES[BLADEMASTER]!.skillIds]);
  });
});

describe('validateEquippedDisciplines', () => {
  it('accepts up to two distinct known disciplines', () => {
    expect(validateEquippedDisciplines([PYROMANCY])).toBe(true);
    expect(validateEquippedDisciplines([PYROMANCY, BLADEMASTER])).toBe(true);
    expect(validateEquippedDisciplines([])).toBe(true);
  });
  it('rejects more than the cap, duplicates, and unknowns', () => {
    expect(validateEquippedDisciplines([PYROMANCY, BLADEMASTER, 'necromancer'])).toBe(false);
    expect(MAX_EQUIPPED_DISCIPLINES).toBe(2);
    expect(validateEquippedDisciplines([PYROMANCY, PYROMANCY])).toBe(false);
    expect(validateEquippedDisciplines([PYROMANCY, 'ranger'])).toBe(false);
    expect(validateEquippedDisciplines('pyromancy')).toBe(false);
  });
});

describe('validateHotbar (free-pick across equipped disciplines)', () => {
  const equipped = [PYROMANCY, BLADEMASTER];

  it('accepts any 6 skills drawn from the equipped pools', () => {
    expect(validateHotbar(['spark', 'fireball', 'slash', 'cleave', 'blade-dash', 'meteor'], equipped)).toBe(true);
    expect(HOTBAR_SIZE).toBe(6);
  });

  it('mixes disciplines freely (3 pyro + 3 blade)', () => {
    expect(validateHotbar(['spark', 'fireball', 'meteor', 'slash', 'cleave', 'decisive-strike'], equipped)).toBe(true);
  });

  it('rejects a skill from a discipline that is not equipped', () => {
    expect(validateHotbar(['slash'], [PYROMANCY])).toBe(false); // blade skill, pyro-only loadout
  });

  it('rejects more than HOTBAR_SIZE and duplicates', () => {
    expect(validateHotbar(['spark', 'fireball', 'meteor', 'slash', 'cleave', 'blade-dash', 'heat-wave'], equipped)).toBe(false);
    expect(validateHotbar(['spark', 'spark'], equipped)).toBe(false);
  });

  it('skillsForDisciplines unions the pools', () => {
    expect(skillsForDisciplines([BLADEMASTER])).toContain('slash');
    expect(skillsForDisciplines([BLADEMASTER])).not.toContain('spark');
  });
});

describe('validateLearnedEquip (S12 trainer-quest gate)', () => {
  it('allows equipping only learned disciplines', () => {
    expect(validateLearnedEquip([PYROMANCY], [PYROMANCY])).toBe(true);
    expect(validateLearnedEquip([PYROMANCY, BLADEMASTER], [PYROMANCY, BLADEMASTER])).toBe(true);
    expect(validateLearnedEquip([], [PYROMANCY])).toBe(true);
  });

  it('rejects equipping a discipline the player has not learned', () => {
    expect(validateLearnedEquip([BLADEMASTER], [PYROMANCY])).toBe(false);
    expect(validateLearnedEquip([PYROMANCY, BLADEMASTER], [PYROMANCY])).toBe(false);
    expect(validateLearnedEquip([PYROMANCY], [])).toBe(false);
  });
});

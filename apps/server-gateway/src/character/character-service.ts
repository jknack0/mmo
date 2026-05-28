import type { Character, CharacterRepo } from './character-repo.js';

export type CharacterError =
  | 'name-too-short'
  | 'name-too-long'
  | 'name-invalid-chars'
  | 'name-taken';

export type CreateCharacterOutcome =
  | { ok: true; character: Character }
  | { ok: false; error: CharacterError };

export interface CharacterService {
  listCharacters(accountId: string): Promise<Character[]>;
  createCharacter(accountId: string, name: string): Promise<CreateCharacterOutcome>;
  loadCharacter(accountId: string, characterId: string): Promise<Character | null>;
}

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 20;
// Letters, digits, single internal spaces or hyphens. Common MMO charset.
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 '-]*[A-Za-z0-9]$|^[A-Za-z0-9]$/;

function validateName(raw: string): { ok: true; value: string } | { ok: false; error: CharacterError } {
  const trimmed = raw.trim();
  if (trimmed.length < MIN_NAME_LENGTH) return { ok: false, error: 'name-too-short' };
  if (trimmed.length > MAX_NAME_LENGTH) return { ok: false, error: 'name-too-long' };
  if (!NAME_PATTERN.test(trimmed)) return { ok: false, error: 'name-invalid-chars' };
  return { ok: true, value: trimmed };
}

export interface CharacterServiceOptions {
  characterRepo: CharacterRepo;
}

export function createCharacterService(opts: CharacterServiceOptions): CharacterService {
  const { characterRepo } = opts;

  return {
    listCharacters: (accountId) => characterRepo.listByAccount(accountId),

    async createCharacter(accountId, rawName) {
      const validated = validateName(rawName);
      if (!validated.ok) return validated;

      const existing = await characterRepo.findByAccountAndName(accountId, validated.value);
      if (existing) return { ok: false, error: 'name-taken' };

      const character = await characterRepo.create({ accountId, name: validated.value });
      return { ok: true, character };
    },

    async loadCharacter(accountId, characterId) {
      const character = await characterRepo.findById(characterId);
      if (!character || character.accountId !== accountId) return null;
      await characterRepo.touchLastLogin(characterId);
      return { ...character, lastLoginAt: new Date() };
    },
  };
}

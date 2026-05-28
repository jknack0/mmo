import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createDb } from '../db/client.js';
import { env } from '../env.js';
import type { Database } from '../db/types.js';
import { createAccountRepo, type AccountRepo } from '../auth/account-repo.js';
import { createCharacterRepo } from './character-repo.js';
import { createCharacterService } from './character-service.js';

describe('CharacterService', () => {
  let db: Kysely<Database>;
  let accounts: AccountRepo;
  let service: ReturnType<typeof createCharacterService>;
  let acctA: string;
  let acctB: string;

  beforeAll(() => {
    db = createDb(env.databaseUrl);
    accounts = createAccountRepo(db);
    service = createCharacterService({ characterRepo: createCharacterRepo(db) });
  });

  beforeEach(async () => {
    await db.deleteFrom('characters').execute();
    await db.deleteFrom('accounts').execute();
    acctA = (await accounts.create({ email: 'a@example.com', passwordHash: 'h' })).id;
    acctB = (await accounts.create({ email: 'b@example.com', passwordHash: 'h' })).id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('createCharacter', () => {
    it('creates a character on a valid name', async () => {
      const result = await service.createCharacter(acctA, 'Aragorn');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.character.name).toBe('Aragorn');
    });

    it('rejects a duplicate name (case-insensitive) with name-taken', async () => {
      await service.createCharacter(acctA, 'Frodo');
      const second = await service.createCharacter(acctA, 'FRODO');
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error).toBe('name-taken');
    });

    it('rejects names shorter than 2 chars with name-too-short', async () => {
      const result = await service.createCharacter(acctA, 'X');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('name-too-short');
    });

    it('rejects names longer than 20 chars with name-too-long', async () => {
      const result = await service.createCharacter(acctA, 'X'.repeat(21));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('name-too-long');
    });

    it('rejects names with disallowed characters with name-invalid-chars', async () => {
      const result = await service.createCharacter(acctA, 'Bad<Name>');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('name-invalid-chars');
    });

    it('rejects empty / whitespace-only names with name-too-short', async () => {
      const result = await service.createCharacter(acctA, '   ');
      expect(result.ok).toBe(false);
    });

    it('trims surrounding whitespace before validation', async () => {
      const result = await service.createCharacter(acctA, '  Legolas  ');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.character.name).toBe('Legolas');
    });
  });

  describe('listCharacters', () => {
    it('returns characters for the account in creation order', async () => {
      await service.createCharacter(acctA, 'First');
      await service.createCharacter(acctA, 'Second');
      const list = await service.listCharacters(acctA);
      expect(list.map((c) => c.name)).toEqual(['First', 'Second']);
    });

    it('does not leak other accounts characters', async () => {
      await service.createCharacter(acctA, 'A1');
      await service.createCharacter(acctB, 'B1');
      const list = await service.listCharacters(acctA);
      expect(list).toHaveLength(1);
      expect(list[0]?.name).toBe('A1');
    });
  });

  describe('loadCharacter', () => {
    it('returns the character for its owning account', async () => {
      const created = await service.createCharacter(acctA, 'Mine');
      if (!created.ok) throw new Error('precondition');
      const loaded = await service.loadCharacter(acctA, created.character.id);
      expect(loaded?.name).toBe('Mine');
    });

    it('returns null if accountId does not own the character', async () => {
      const created = await service.createCharacter(acctA, 'NotYours');
      if (!created.ok) throw new Error('precondition');
      const loaded = await service.loadCharacter(acctB, created.character.id);
      expect(loaded).toBeNull();
    });

    it('returns null for unknown character id', async () => {
      const loaded = await service.loadCharacter(
        acctA,
        '00000000-0000-0000-0000-000000000000'
      );
      expect(loaded).toBeNull();
    });

    it('touches last_login_at on successful load', async () => {
      const created = await service.createCharacter(acctA, 'TouchLoad');
      if (!created.ok) throw new Error('precondition');
      expect(created.character.lastLoginAt).toBeNull();
      const loaded = await service.loadCharacter(acctA, created.character.id);
      expect(loaded?.lastLoginAt).toBeInstanceOf(Date);
    });
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createDb } from '../db/client.js';
import { env } from '../env.js';
import type { Database } from '../db/types.js';
import { createAccountRepo, type AccountRepo } from '../auth/account-repo.js';
import { createCharacterRepo } from './character-repo.js';

describe('CharacterRepo', () => {
  let db: Kysely<Database>;
  let accounts: AccountRepo;
  let repo: ReturnType<typeof createCharacterRepo>;
  let acctA: string;
  let acctB: string;

  beforeAll(() => {
    db = createDb(env.databaseUrl);
    accounts = createAccountRepo(db);
    repo = createCharacterRepo(db);
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

  it('creates a character and returns it with id + timestamps', async () => {
    const c = await repo.create({ accountId: acctA, name: 'Alice' });
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.accountId).toBe(acctA);
    expect(c.name).toBe('Alice');
    expect(c.createdAt).toBeInstanceOf(Date);
    expect(c.lastLoginAt).toBeNull();
  });

  it('rejects duplicate names within the same account (case-insensitive)', async () => {
    await repo.create({ accountId: acctA, name: 'Alice' });
    await expect(repo.create({ accountId: acctA, name: 'alice' })).rejects.toThrow();
  });

  it('allows the same name across different accounts', async () => {
    await repo.create({ accountId: acctA, name: 'Hero' });
    const second = await repo.create({ accountId: acctB, name: 'Hero' });
    expect(second.id).toBeTruthy();
  });

  it('listByAccount returns characters in stable order, newest last', async () => {
    await repo.create({ accountId: acctA, name: 'First' });
    await repo.create({ accountId: acctA, name: 'Second' });
    const list = await repo.listByAccount(acctA);
    expect(list.map((c) => c.name)).toEqual(['First', 'Second']);
  });

  it('listByAccount returns empty array for accounts with no characters', async () => {
    expect(await repo.listByAccount(acctA)).toEqual([]);
  });

  it('listByAccount does not leak characters from other accounts', async () => {
    await repo.create({ accountId: acctA, name: 'Alpha' });
    await repo.create({ accountId: acctB, name: 'Beta' });
    const list = await repo.listByAccount(acctA);
    expect(list.map((c) => c.name)).toEqual(['Alpha']);
  });

  it('findByAccountAndName is case-insensitive', async () => {
    await repo.create({ accountId: acctA, name: 'CaseUser' });
    expect((await repo.findByAccountAndName(acctA, 'caseuser'))?.name).toBe('CaseUser');
    expect((await repo.findByAccountAndName(acctA, 'CASEUSER'))?.name).toBe('CaseUser');
  });

  it('touchLastLogin sets last_login_at on the character', async () => {
    const c = await repo.create({ accountId: acctA, name: 'TouchMe' });
    expect(c.lastLoginAt).toBeNull();
    await repo.touchLastLogin(c.id);
    const after = await repo.findById(c.id);
    expect(after?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('findById returns null for unknown id', async () => {
    expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

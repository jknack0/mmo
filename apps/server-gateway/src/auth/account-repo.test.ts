import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createDb } from '../db/client.js';
import { env } from '../env.js';
import type { Database } from '../db/types.js';
import { createAccountRepo } from './account-repo.js';

describe('AccountRepo', () => {
  let db: Kysely<Database>;
  let repo: ReturnType<typeof createAccountRepo>;

  beforeAll(() => {
    db = createDb(env.databaseUrl);
    repo = createAccountRepo(db);
  });

  beforeEach(async () => {
    await db.deleteFrom('accounts').execute();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('creates an email account and returns it with a UUID and timestamp', async () => {
    const created = await repo.create({
      email: 'alice@example.com',
      passwordHash: 'hash-placeholder',
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.email).toBe('alice@example.com');
    expect(created.passwordHash).toBe('hash-placeholder');
    expect(created.discordId).toBeNull();
    expect(created.createdAt).toBeInstanceOf(Date);
  });

  it('finds an account by email after create', async () => {
    await repo.create({ email: 'bob@example.com', passwordHash: 'hash' });
    const found = await repo.findByEmail('bob@example.com');
    expect(found?.email).toBe('bob@example.com');
  });

  it('returns null when finding by an unknown email', async () => {
    expect(await repo.findByEmail('nobody@example.com')).toBeNull();
  });

  it('finds an account by discordId after create', async () => {
    await repo.create({ discordId: 'discord-123' });
    const found = await repo.findByDiscordId('discord-123');
    expect(found?.discordId).toBe('discord-123');
  });

  it('enforces unique email constraint', async () => {
    await repo.create({ email: 'dup@example.com', passwordHash: 'h' });
    await expect(
      repo.create({ email: 'dup@example.com', passwordHash: 'h2' })
    ).rejects.toThrow();
  });

  it('enforces unique discordId constraint', async () => {
    await repo.create({ discordId: 'dup-discord' });
    await expect(
      repo.create({ discordId: 'dup-discord' })
    ).rejects.toThrow();
  });

  it('allows multiple null discord_ids (partial unique index)', async () => {
    await repo.create({ email: 'a@example.com', passwordHash: 'h' });
    await expect(
      repo.create({ email: 'b@example.com', passwordHash: 'h' })
    ).resolves.toBeTruthy();
  });
});

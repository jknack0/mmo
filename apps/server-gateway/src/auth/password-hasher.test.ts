import { describe, it, expect } from 'vitest';
import { createPasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  const hasher = createPasswordHasher({ rounds: 4 });

  it('verifies a password against its own hash', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(await hasher.verify('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password against a hash', async () => {
    const hash = await hasher.hash('right-password');
    expect(await hasher.verify('wrong-password', hash)).toBe(false);
  });

  it('produces different hashes for the same password (salted)', async () => {
    const a = await hasher.hash('same-password');
    const b = await hasher.hash('same-password');
    expect(a).not.toBe(b);
  });
});

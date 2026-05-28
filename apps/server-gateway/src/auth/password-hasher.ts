import bcrypt from 'bcrypt';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export interface PasswordHasherOptions {
  rounds: number;
}

export function createPasswordHasher(opts: PasswordHasherOptions): PasswordHasher {
  return {
    hash: (password) => bcrypt.hash(password, opts.rounds),
    verify: (password, hash) => bcrypt.compare(password, hash),
  };
}

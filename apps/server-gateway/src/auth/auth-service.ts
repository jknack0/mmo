import { randomBytes } from 'node:crypto';
import type { AccountRepo } from './account-repo.js';
import type { SessionStore } from './session-store.js';
import type { PasswordHasher } from './password-hasher.js';
import type {
  Credentials,
  AuthOutcome,
  DiscordClient,
} from './types.js';
import type { RedisClient } from '../redis/client.js';

export interface AuthServiceOptions {
  accountRepo: AccountRepo;
  sessionStore: SessionStore;
  passwordHasher: PasswordHasher;
  discordClient: DiscordClient;
  discord: { clientId: string; clientSecret: string; redirectUrl: string };
  passwordMinLength: number;
  redis: RedisClient;
  /** CSRF state TTL for the Discord OAuth roundtrip. */
  oauthStateTtlSeconds?: number;
}

export interface AuthService {
  authenticate(creds: Credentials): Promise<AuthOutcome>;
  validateSession(token: string): Promise<{ accountId: string } | null>;
  revokeSession(token: string): Promise<void>;
  generateDiscordOAuthStart(): Promise<{ url: string; state: string }>;
}

const DISCORD_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const DEFAULT_OAUTH_STATE_TTL = 5 * 60;

function oauthStateKey(state: string): string {
  return `oauth-state:${state}`;
}

function generateState(): string {
  return randomBytes(24).toString('base64url');
}

export function createAuthService(opts: AuthServiceOptions): AuthService {
  const {
    accountRepo,
    sessionStore,
    passwordHasher,
    discordClient,
    discord,
    passwordMinLength,
    redis,
    oauthStateTtlSeconds = DEFAULT_OAUTH_STATE_TTL,
  } = opts;

  async function emailRegister(
    email: string,
    password: string
  ): Promise<AuthOutcome> {
    if (password.length < passwordMinLength) {
      return { ok: false, error: 'weak-password' };
    }
    const existing = await accountRepo.findByEmail(email);
    if (existing) {
      return { ok: false, error: 'email-already-exists' };
    }
    const passwordHash = await passwordHasher.hash(password);
    const account = await accountRepo.create({ email, passwordHash });
    const sessionToken = await sessionStore.issue(account.id);
    return { ok: true, sessionToken, accountId: account.id };
  }

  async function emailLogin(
    email: string,
    password: string
  ): Promise<AuthOutcome> {
    const account = await accountRepo.findByEmail(email);
    if (!account || !account.passwordHash) {
      return { ok: false, error: 'invalid-credentials' };
    }
    const ok = await passwordHasher.verify(password, account.passwordHash);
    if (!ok) {
      return { ok: false, error: 'invalid-credentials' };
    }
    const sessionToken = await sessionStore.issue(account.id);
    return { ok: true, sessionToken, accountId: account.id };
  }

  async function discordExchange(
    code: string,
    state: string
  ): Promise<AuthOutcome> {
    // Consume state atomically — DEL returns 1 if the key existed, 0 if not.
    const consumed = await redis.del(oauthStateKey(state));
    if (consumed === 0) {
      return { ok: false, error: 'discord-state-invalid' };
    }

    let accessToken: string;
    let user: { id: string; username: string };
    try {
      ({ accessToken } = await discordClient.exchangeCodeForToken(code));
      user = await discordClient.fetchUser(accessToken);
    } catch {
      return { ok: false, error: 'discord-exchange-failed' };
    }

    const existing = await accountRepo.findByDiscordId(user.id);
    const account = existing ?? (await accountRepo.create({ discordId: user.id }));
    const sessionToken = await sessionStore.issue(account.id);
    return { ok: true, sessionToken, accountId: account.id };
  }

  return {
    async authenticate(creds) {
      switch (creds.kind) {
        case 'email-register':
          return emailRegister(creds.email, creds.password);
        case 'email-login':
          return emailLogin(creds.email, creds.password);
        case 'discord-code':
          return discordExchange(creds.code, creds.state);
      }
    },

    validateSession: (token) => sessionStore.validate(token),
    revokeSession: (token) => sessionStore.revoke(token),

    async generateDiscordOAuthStart() {
      const state = generateState();
      await redis.set(
        oauthStateKey(state),
        '1',
        'EX',
        oauthStateTtlSeconds
      );
      const url =
        `${DISCORD_AUTHORIZE_URL}?` +
        new URLSearchParams({
          client_id: discord.clientId,
          redirect_uri: discord.redirectUrl,
          response_type: 'code',
          scope: 'identify',
          state,
        }).toString();
      return { url, state };
    },
  };
}

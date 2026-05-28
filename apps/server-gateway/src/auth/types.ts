// Inputs to AuthService.authenticate.
export type Credentials =
  | { kind: 'discord-code'; code: string; state: string }
  | { kind: 'email-register'; email: string; password: string }
  | { kind: 'email-login'; email: string; password: string };

// All possible failure reasons surfaced to the HTTP layer.
export type AuthError =
  | 'invalid-credentials'
  | 'email-already-exists'
  | 'weak-password'
  | 'discord-state-invalid'
  | 'discord-exchange-failed';

export type AuthOutcome =
  | { ok: true; sessionToken: string; accountId: string }
  | { ok: false; error: AuthError };

// Discord-side OAuth integration. Stub-implementable so AuthService can be
// tested without hitting Discord, real-implementable to ship.
export interface DiscordClient {
  exchangeCodeForToken(code: string): Promise<{ accessToken: string }>;
  fetchUser(accessToken: string): Promise<DiscordUser>;
}

export interface DiscordUser {
  id: string;
  username: string;
}

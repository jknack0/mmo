// Thin HTTP client for the Gateway auth endpoints.
// Stores the session token in localStorage; reads it back on boot.

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';
const TOKEN_KEY = 'mmo.sessionToken';
const ACCOUNT_KEY = 'mmo.accountId';

export interface AuthSuccess {
  ok: true;
  sessionToken: string;
  accountId: string;
}

export interface AuthFailure {
  ok: false;
  error: string;
  status: number;
}

export type AuthResult = AuthSuccess | AuthFailure;

async function postJson(
  path: string,
  body: Record<string, unknown>
): Promise<AuthResult> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as
    | { sessionToken: string; accountId: string }
    | { error: string };
  if (res.ok && 'sessionToken' in data) {
    storeSession(data.sessionToken, data.accountId);
    return { ok: true, sessionToken: data.sessionToken, accountId: data.accountId };
  }
  return {
    ok: false,
    error: 'error' in data ? data.error : 'unknown',
    status: res.status,
  };
}

export function registerEmail(email: string, password: string): Promise<AuthResult> {
  return postJson('/auth/email/register', { email, password });
}

export function loginEmail(email: string, password: string): Promise<AuthResult> {
  return postJson('/auth/email/login', { email, password });
}

export function startDiscordOAuth(): void {
  window.location.href = `${GATEWAY_URL}/auth/discord/start`;
}

export function storeSession(token: string, accountId: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ACCOUNT_KEY, accountId);
}

export function loadSession(): { sessionToken: string; accountId: string } | null {
  const sessionToken = localStorage.getItem(TOKEN_KEY);
  const accountId = localStorage.getItem(ACCOUNT_KEY);
  return sessionToken && accountId ? { sessionToken, accountId } : null;
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
}

/**
 * Read a fresh session+error pair from the URL (Discord callback redirect leaves
 * `?session=...` or `?error=...` on the client origin). Returns null if neither
 * is present, otherwise persists the token and cleans the URL.
 */
export function consumeOAuthRedirect():
  | { kind: 'success'; sessionToken: string }
  | { kind: 'error'; error: string }
  | null {
  const params = new URLSearchParams(window.location.search);
  const session = params.get('session');
  const error = params.get('error');
  if (!session && !error) return null;

  // Strip params from the URL so refresh doesn't reprocess.
  const clean = new URL(window.location.href);
  clean.searchParams.delete('session');
  clean.searchParams.delete('error');
  window.history.replaceState({}, '', clean.toString());

  if (session) {
    // accountId is not in the redirect — server only returns token in the URL.
    // The client will fetch identity from a future /me endpoint; until then
    // store token alone with a placeholder accountId.
    localStorage.setItem(TOKEN_KEY, session);
    return { kind: 'success', sessionToken: session };
  }
  return { kind: 'error', error: error ?? 'unknown' };
}

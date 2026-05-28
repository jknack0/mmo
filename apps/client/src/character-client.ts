// Thin HTTP client for the gateway's character endpoints. All calls require
// a Bearer token (the session token issued by the auth flow).

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

export interface Character {
  id: string;
  accountId: string;
  name: string;
  createdAt: string;
  lastLoginAt: string | null;
}

function authHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

export async function fetchMe(token: string): Promise<{ accountId: string } | null> {
  const res = await fetch(`${GATEWAY_URL}/me`, { headers: authHeaders(token) });
  if (!res.ok) return null;
  return (await res.json()) as { accountId: string };
}

export async function listCharacters(token: string): Promise<Character[]> {
  const res = await fetch(`${GATEWAY_URL}/characters`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`list characters failed: ${res.status}`);
  const body = (await res.json()) as { characters: Character[] };
  return body.characters;
}

export type CreateCharacterResult =
  | { ok: true; character: Character }
  | { ok: false; error: string };

export async function createCharacter(
  token: string,
  name: string
): Promise<CreateCharacterResult> {
  const res = await fetch(`${GATEWAY_URL}/characters`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { character?: Character; error?: string };
  if (res.ok && body.character) {
    return { ok: true, character: body.character };
  }
  return { ok: false, error: body.error ?? 'unknown' };
}

export async function playCharacter(
  token: string,
  characterId: string
): Promise<Character | null> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/play`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { character: Character };
  return body.character;
}

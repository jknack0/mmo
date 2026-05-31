// Client discipline data + HTTP helpers (S11 #13). The discipline catalog comes
// from @mmo/domain so the panel matches the server's mixing rules.

export {
  DISCIPLINES,
  ALL_DISCIPLINE_IDS,
  PYROMANCY,
  BLADEMASTER,
  MAX_EQUIPPED_DISCIPLINES,
  DISCIPLINE_SWITCH_COST,
  validateEquippedDisciplines,
  type DisciplineDef,
} from '@mmo/domain';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

export async function fetchDisciplines(token: string, characterId: string): Promise<string[]> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/disciplines`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return ((await res.json()) as { equipped: string[] }).equipped;
}

export type SetDisciplinesResult =
  | { ok: true; equipped: string[]; gold: number }
  | { ok: false; error: string };

export async function setDisciplines(
  token: string,
  characterId: string,
  equipped: string[]
): Promise<SetDisciplinesResult> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/disciplines`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ equipped }),
  });
  const body = await res.json();
  if (!res.ok) return { ok: false, error: body.error ?? 'failed' };
  return { ok: true, equipped: body.equipped, gold: body.gold };
}

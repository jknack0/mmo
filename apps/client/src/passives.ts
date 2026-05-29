// Client passive-tree data + HTTP helpers (S10 #12). Node metadata and the
// allocation rules are imported straight from @mmo/domain so the panel can
// never drift from the server's canonical tree — the SERVER stays the source
// of truth for stat resolution; the client only renders + previews validity.

export {
  PASSIVE_NODES,
  PASSIVE_POOL_SIZE,
  getNode,
  validateAllocation,
  allocatableNodes,
  totalPointsSpent,
  type PassiveNode,
  type PassivePath,
  type PassiveAllocation,
} from '@mmo/domain';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

export async function fetchPassives(
  token: string,
  characterId: string
): Promise<Record<string, number>> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/passives`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return {};
  const body = (await res.json()) as { allocation: Record<string, number> };
  return body.allocation ?? {};
}

export async function savePassives(
  token: string,
  characterId: string,
  allocation: Record<string, number>
): Promise<boolean> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/passives`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ allocation }),
  });
  return res.ok;
}

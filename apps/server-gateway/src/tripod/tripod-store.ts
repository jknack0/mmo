// Gateway-side companion to server-channel/persistence/tripod-store.
// Same Redis key shape (`tripods:{characterId}`). Keeping the helper local
// avoids a cross-app import; the schema is small and shared by contract.

import type { RedisClient } from '../redis/client.js';

export type TripodSelection = { t1: number; t2: number };
export type TripodLoadout = Record<string, TripodSelection>;

function key(characterId: string): string {
  return `tripods:${characterId}`;
}

export async function loadTripods(
  redis: RedisClient,
  characterId: string
): Promise<TripodLoadout> {
  const raw = await redis.get(key(characterId));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as TripodLoadout;
  } catch {
    return {};
  }
}

export async function saveTripods(
  redis: RedisClient,
  characterId: string,
  loadout: TripodLoadout
): Promise<void> {
  await redis.set(key(characterId), JSON.stringify(loadout));
}

export function validateLoadout(input: unknown): input is TripodLoadout {
  if (typeof input !== 'object' || input === null) return false;
  for (const [, v] of Object.entries(input)) {
    if (typeof v !== 'object' || v === null) return false;
    const sel = v as TripodSelection;
    if (typeof sel.t1 !== 'number' || typeof sel.t2 !== 'number') return false;
    if (sel.t1 < -1 || sel.t1 > 2 || sel.t2 < -1 || sel.t2 > 2) return false;
  }
  return true;
}

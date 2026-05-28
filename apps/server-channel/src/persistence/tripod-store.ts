// Tripod-selection persistence in Redis. Gateway writes the loadout here
// when the player saves a selection; channel reads it on Hello to attach
// to the spawned ServerPlayer. Keeping this out of Postgres for alpha
// avoids a schema migration — Redis survives channel restarts and the
// data is small + lightly mutable.

import type Redis from 'ioredis';
import type { PlayerTripodLoadout } from '../combat/tripods.js';

function key(characterId: string): string {
  return `tripods:${characterId}`;
}

export async function loadTripods(
  redis: Redis,
  characterId: string
): Promise<PlayerTripodLoadout> {
  const raw = await redis.get(key(characterId));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PlayerTripodLoadout;
  } catch {
    return {};
  }
}

export async function saveTripods(
  redis: Redis,
  characterId: string,
  loadout: PlayerTripodLoadout
): Promise<void> {
  await redis.set(key(characterId), JSON.stringify(loadout));
}

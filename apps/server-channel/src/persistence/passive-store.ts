// Passive-allocation persistence in Redis (S10 #12). Companion to the gateway
// store — same key shape (`passives:{characterId}`). Gateway writes the
// allocation when the player saves their tree; channel reads it on Hello to
// fold into the spawned ServerPlayer's derivedStats. Kept out of Postgres for
// alpha for the same reasons as tripods: small, lightly-mutable, no migration.

import type Redis from 'ioredis';
import type { PassiveAllocation } from '@mmo/domain';

function key(characterId: string): string {
  return `passives:${characterId}`;
}

export async function loadPassives(
  redis: Redis,
  characterId: string
): Promise<PassiveAllocation> {
  const raw = await redis.get(key(characterId));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PassiveAllocation;
  } catch {
    return {};
  }
}

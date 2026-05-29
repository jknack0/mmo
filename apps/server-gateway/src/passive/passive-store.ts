// Gateway-side passive-allocation persistence (S10 #12). Mirrors the tripod
// store: small, lightly-mutable loadout data lives in Redis (key
// `passives:{characterId}`) rather than Postgres, so the channel reads it on
// Hello with no schema migration. Validation reuses the domain's
// validateAllocation so prerequisite gating + the 20-point pool are enforced
// in exactly one place.

import type { RedisClient } from '../redis/client.js';
import { validateAllocation, type PassiveAllocation } from '@mmo/domain';

function key(characterId: string): string {
  return `passives:${characterId}`;
}

export async function loadPassives(
  redis: RedisClient,
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

export async function savePassives(
  redis: RedisClient,
  characterId: string,
  allocation: PassiveAllocation
): Promise<void> {
  await redis.set(key(characterId), JSON.stringify(allocation));
}

/** True when `input` is a structurally + rule-valid allocation. */
export function isValidAllocation(input: unknown): input is PassiveAllocation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  for (const v of Object.values(input)) {
    if (typeof v !== 'number') return false;
  }
  return validateAllocation(input as PassiveAllocation).ok;
}

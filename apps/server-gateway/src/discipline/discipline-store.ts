// Gateway-side equipped-disciplines persistence (S11 #13). Like tripods/passives
// the loadout lives in Redis (`disciplines:{characterId}`) so the channel reads
// it on Hello with no migration. Default = Pyromancy only (the alpha starter).

import type { RedisClient } from '../redis/client.js';
import { PYROMANCY, validateEquippedDisciplines } from '@mmo/domain';

function key(characterId: string): string {
  return `disciplines:${characterId}`;
}

export async function loadDisciplines(redis: RedisClient, characterId: string): Promise<string[]> {
  const raw = await redis.get(key(characterId));
  if (!raw) return [PYROMANCY];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [PYROMANCY];
  } catch {
    return [PYROMANCY];
  }
}

export async function saveDisciplines(redis: RedisClient, characterId: string, equipped: string[]): Promise<void> {
  await redis.set(key(characterId), JSON.stringify(equipped));
}

export { validateEquippedDisciplines };

// Client trainer-quest data + HTTP helpers (S12 #14). Quest defs come from
// @mmo/domain so the log/dialog match the server's FSM; the gateway owns
// persistence and the learned-discipline gate.

export {
  TRAINER_QUESTS,
  PYRO_QUEST_ID,
  BLADE_QUEST_ID,
  questByTrainer,
  type QuestDef,
  type QuestState,
} from '@mmo/domain';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

/** A quest entry as the gateway returns it: def fields + live FSM progress. */
export interface QuestLogEntry {
  id: string;
  name: string;
  trainerId: string;
  discipline: string;
  mobKind: string;
  killTarget: number;
  state: string;
  kills: number;
}

export interface QuestLog {
  quests: QuestLogEntry[];
  learned: string[];
}

function authH(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

export async function fetchQuests(token: string, characterId: string): Promise<QuestLog> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/quests`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { quests: [], learned: [] };
  return (await res.json()) as QuestLog;
}

async function questAction(
  token: string,
  characterId: string,
  questId: string,
  action: 'start' | 'kill' | 'turn-in'
): Promise<{ ok: boolean; state?: string; kills?: number; learned?: string; error?: string }> {
  const res = await fetch(`${GATEWAY_URL}/characters/${characterId}/quests/${questId}/${action}`, {
    method: 'POST',
    headers: authH(token),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? 'failed' };
  return { ok: true, ...body };
}

export const startQuest = (t: string, c: string, q: string) => questAction(t, c, q, 'start');
export const reportQuestKill = (t: string, c: string, q: string) => questAction(t, c, q, 'kill');
export const turnInQuest = (t: string, c: string, q: string) => questAction(t, c, q, 'turn-in');

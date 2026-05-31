// Trainer learn-discipline quests (S12 #14). A character unlocks a discipline by
// completing its trainer's short quest (kill N placeholder mobs, return to the
// trainer). Pure FSM + data — the gateway persists `QuestProgress` and, on
// turn-in, writes the unlocked discipline to `disciplines_learned`; combat /
// equip then gates on the learned set (see disciplines.ts `validateLearnedEquip`).
//
// FSM: NotStarted → InProgress → ReadyToTurnIn → Completed. Transitions are pure
// functions returning a discriminated result so callers never mutate in place.

import { PYROMANCY, BLADEMASTER } from './disciplines.js';

export type QuestState = 'NotStarted' | 'InProgress' | 'ReadyToTurnIn' | 'Completed';

export interface QuestDef {
  id: string;
  /** NPC id (zones.ts) the player talks to — drives the right-click prompt. */
  trainerId: string;
  /** Discipline unlocked on turn-in. */
  discipline: string;
  /** Mob kind whose death counts toward the quest. */
  mobKind: string;
  /** Kills required to flip InProgress → ReadyToTurnIn. */
  killTarget: number;
  name: string;
}

export interface QuestProgress {
  questId: string;
  state: QuestState;
  kills: number;
}

export const PYRO_QUEST_ID = 'learn-pyromancy';
export const BLADE_QUEST_ID = 'learn-blademaster';

const QUEST_KILL_TARGET = 3;

export const TRAINER_QUESTS: QuestDef[] = [
  {
    id: PYRO_QUEST_ID,
    trainerId: 'trainer-pyro',
    discipline: PYROMANCY,
    mobKind: 'skeleton',
    killTarget: QUEST_KILL_TARGET,
    name: 'Trial of Embers',
  },
  {
    id: BLADE_QUEST_ID,
    trainerId: 'trainer-blade',
    discipline: BLADEMASTER,
    mobKind: 'skeleton',
    killTarget: QUEST_KILL_TARGET,
    name: 'Proving the Blade',
  },
];

const QUEST_BY_ID = new Map(TRAINER_QUESTS.map((q) => [q.id, q]));
const QUEST_BY_TRAINER = new Map(TRAINER_QUESTS.map((q) => [q.trainerId, q]));

export function getQuest(questId: string): QuestDef | undefined {
  return QUEST_BY_ID.get(questId);
}

export function questByTrainer(trainerId: string): QuestDef | undefined {
  return QUEST_BY_TRAINER.get(trainerId);
}

export function initialProgress(questId: string): QuestProgress {
  return { questId, state: 'NotStarted', kills: 0 };
}

export type StartResult =
  | { ok: true; progress: QuestProgress }
  | { ok: false; error: 'already-started' };

/** NotStarted → InProgress. Rejected once the quest is already underway/done. */
export function startQuest(progress: QuestProgress): StartResult {
  if (progress.state !== 'NotStarted') return { ok: false, error: 'already-started' };
  return { ok: true, progress: { ...progress, state: 'InProgress' } };
}

export interface KillResult {
  progress: QuestProgress;
  /** Whether this kill changed progress (false off-quest or already at target). */
  changed: boolean;
}

/**
 * Count one qualifying kill. Only mutates while InProgress; clamps at killTarget
 * and flips to ReadyToTurnIn on reaching it. Off-state kills are no-ops so a
 * stray death event never corrupts a NotStarted/Completed quest.
 */
export function recordQuestKill(progress: QuestProgress, quest: QuestDef): KillResult {
  if (progress.state !== 'InProgress') return { progress, changed: false };
  const kills = Math.min(progress.kills + 1, quest.killTarget);
  if (kills === progress.kills) return { progress, changed: false };
  const state: QuestState = kills >= quest.killTarget ? 'ReadyToTurnIn' : 'InProgress';
  return { progress: { ...progress, kills, state }, changed: true };
}

export type TurnInResult =
  | { ok: true; progress: QuestProgress; learned: string }
  | { ok: false; error: 'not-ready' };

/** ReadyToTurnIn → Completed, yielding the discipline the character now knows. */
export function turnInQuest(progress: QuestProgress, quest: QuestDef): TurnInResult {
  if (progress.state !== 'ReadyToTurnIn') return { ok: false, error: 'not-ready' };
  return {
    ok: true,
    progress: { ...progress, state: 'Completed' },
    learned: quest.discipline,
  };
}

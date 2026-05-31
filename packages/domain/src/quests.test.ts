import { describe, it, expect } from 'vitest';
import {
  TRAINER_QUESTS,
  PYRO_QUEST_ID,
  BLADE_QUEST_ID,
  getQuest,
  questByTrainer,
  initialProgress,
  startQuest,
  recordQuestKill,
  turnInQuest,
  type QuestProgress,
} from './quests.js';
import { PYROMANCY, BLADEMASTER } from './disciplines.js';

describe('trainer quest defs', () => {
  it('ships a parallel learn-quest per alpha discipline', () => {
    expect(TRAINER_QUESTS.map((q) => q.discipline).sort()).toEqual([BLADEMASTER, PYROMANCY].sort());
  });

  it('each quest kills 3 of a placeholder mob and is owned by a trainer NPC', () => {
    for (const q of TRAINER_QUESTS) {
      expect(q.killTarget).toBe(3);
      expect(q.mobKind).toBe('skeleton');
      expect(q.trainerId).toMatch(/^trainer-/);
    }
  });

  it('resolves quests by id and by trainer NPC', () => {
    expect(getQuest(PYRO_QUEST_ID)!.discipline).toBe(PYROMANCY);
    expect(getQuest(BLADE_QUEST_ID)!.discipline).toBe(BLADEMASTER);
    expect(questByTrainer('trainer-pyro')!.id).toBe(PYRO_QUEST_ID);
    expect(questByTrainer('trainer-blade')!.id).toBe(BLADE_QUEST_ID);
    expect(getQuest('nope')).toBeUndefined();
    expect(questByTrainer('vendor-veridian')).toBeUndefined();
  });
});

describe('quest FSM: NotStarted → InProgress → ReadyToTurnIn → Completed', () => {
  const quest = getQuest(PYRO_QUEST_ID)!;

  it('initial progress is NotStarted with no kills', () => {
    const p = initialProgress(PYRO_QUEST_ID);
    expect(p).toEqual<QuestProgress>({ questId: PYRO_QUEST_ID, state: 'NotStarted', kills: 0 });
  });

  it('start moves NotStarted → InProgress', () => {
    const r = startQuest(initialProgress(PYRO_QUEST_ID));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.progress.state).toBe('InProgress');
  });

  it('start is rejected once already underway', () => {
    const started = startQuest(initialProgress(PYRO_QUEST_ID));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const again = startQuest(started.progress);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe('already-started');
  });

  it('kills only count while InProgress, and flip to ReadyToTurnIn at the target', () => {
    let p = startQuest(initialProgress(PYRO_QUEST_ID)).ok
      ? (startQuest(initialProgress(PYRO_QUEST_ID)) as { ok: true; progress: QuestProgress }).progress
      : initialProgress(PYRO_QUEST_ID);

    p = recordQuestKill(p, quest).progress;
    expect(p).toMatchObject({ state: 'InProgress', kills: 1 });
    p = recordQuestKill(p, quest).progress;
    p = recordQuestKill(p, quest).progress;
    expect(p).toMatchObject({ state: 'ReadyToTurnIn', kills: 3 });
  });

  it('kills never overflow past the target', () => {
    let p = (startQuest(initialProgress(PYRO_QUEST_ID)) as { ok: true; progress: QuestProgress }).progress;
    for (let i = 0; i < 10; i++) p = recordQuestKill(p, quest).progress;
    expect(p.kills).toBe(3);
    expect(p.state).toBe('ReadyToTurnIn');
  });

  it('recording a kill on a NotStarted quest is a no-op', () => {
    const p = recordQuestKill(initialProgress(PYRO_QUEST_ID), quest);
    expect(p.changed).toBe(false);
    expect(p.progress.state).toBe('NotStarted');
  });

  it('turn-in only succeeds from ReadyToTurnIn and yields the discipline to learn', () => {
    let p = (startQuest(initialProgress(PYRO_QUEST_ID)) as { ok: true; progress: QuestProgress }).progress;

    const tooEarly = turnInQuest(p, quest);
    expect(tooEarly.ok).toBe(false);

    for (let i = 0; i < 3; i++) p = recordQuestKill(p, quest).progress;
    const done = turnInQuest(p, quest);
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(done.progress.state).toBe('Completed');
      expect(done.learned).toBe(PYROMANCY);
    }
  });

  it('a Completed quest cannot be turned in again', () => {
    let p = (startQuest(initialProgress(PYRO_QUEST_ID)) as { ok: true; progress: QuestProgress }).progress;
    for (let i = 0; i < 3; i++) p = recordQuestKill(p, quest).progress;
    p = (turnInQuest(p, quest) as { ok: true; progress: QuestProgress }).progress;
    expect(turnInQuest(p, quest).ok).toBe(false);
  });
});

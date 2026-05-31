// Trainer quest log + interaction panel (S12 #14). Lists both learn-discipline
// quests with live FSM state, lets the player accept a quest from a trainer and
// turn it in once the kills are done. Turn-in unlocks the discipline server-side
// (disciplines_learned) and pops a completion toast.

import { createSignal, onMount, For, Show } from 'solid-js';
import {
  fetchQuests,
  startQuest,
  turnInQuest,
  type QuestLogEntry,
} from './quests.js';
import { DISCIPLINES } from './disciplines.js';

export interface QuestPanelProps {
  token: string;
  characterId: string;
  /** Trainer NPC the player clicked, to highlight its quest. Optional. */
  focusTrainerId?: string;
  onChanged?: () => void;
  onClose: () => void;
}

const STATE_FALLBACK = { text: 'NOT STARTED', color: '#8a7f6e' };
const STATE_LABEL: Record<string, { text: string; color: string }> = {
  NotStarted: STATE_FALLBACK,
  InProgress: { text: 'IN PROGRESS', color: '#ffd24a' },
  ReadyToTurnIn: { text: 'READY', color: '#7CFC9A' },
  Completed: { text: 'LEARNED', color: '#7CFC9A' },
};

export function QuestPanel(props: QuestPanelProps) {
  const [quests, setQuests] = createSignal<QuestLogEntry[]>([]);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [toast, setToast] = createSignal<{ text: string; color: string } | null>(null);

  async function refresh() {
    const log = await fetchQuests(props.token, props.characterId);
    setQuests(log.quests);
  }
  onMount(refresh);

  function disciplineName(id: string): string {
    return DISCIPLINES[id]?.name ?? id;
  }

  async function accept(q: QuestLogEntry) {
    if (busy()) return;
    setBusy(q.id);
    const r = await startQuest(props.token, props.characterId, q.id);
    setBusy(null);
    if (!r.ok) { setToast({ text: r.error ?? 'Could not start', color: '#ff6a6a' }); return; }
    setToast({ text: `Quest accepted: ${q.name}`, color: '#ffd24a' });
    await refresh();
    props.onChanged?.();
  }

  async function turnIn(q: QuestLogEntry) {
    if (busy()) return;
    setBusy(q.id);
    const r = await turnInQuest(props.token, props.characterId, q.id);
    setBusy(null);
    if (!r.ok) { setToast({ text: r.error ?? 'Not ready', color: '#ff6a6a' }); return; }
    setToast({ text: `✦ ${disciplineName(r.learned ?? q.discipline)} unlocked! ✦`, color: '#7CFC9A' });
    await refresh();
    props.onChanged?.();
  }

  return (
    <div class="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col" style={{ 'font-family': 'var(--font-display, monospace)' }}>
      <div class="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div>
          <h2 class="ts-zone-name">Trainers</h2>
          <p class="ts-zone-sub">Complete a trial to learn a discipline · slay skeletons in the Ashen Plains</p>
        </div>
        <button type="button" onClick={props.onClose} class="ts-btn">Close</button>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-6">
        <div class="max-w-2xl mx-auto grid grid-cols-1 gap-3">
          <For each={quests()}>
            {(q) => {
              const badge = () => STATE_LABEL[q.state] ?? STATE_FALLBACK;
              const focused = () => props.focusTrainerId && q.trainerId === props.focusTrainerId;
              return (
                <div
                  class="px-4 py-3"
                  style={{
                    background: '#140e0a',
                    'box-shadow': `0 0 0 2px #080706, 0 0 0 4px ${focused() ? '#ffd24a' : '#2b2420'}, 0 0 0 6px #080706`,
                  }}
                >
                  <div class="flex items-center justify-between">
                    <span class="text-sm" style={{ color: '#e8e0d4' }}>{q.name}</span>
                    <span class="text-[11px] font-semibold" style={{ color: badge().color }}>{badge().text}</span>
                  </div>
                  <div class="text-[11px] text-white/40 mt-1">
                    Reward: learn {disciplineName(q.discipline)} · slay {q.killTarget} {q.mobKind}s
                  </div>

                  <Show when={q.state === 'InProgress' || q.state === 'ReadyToTurnIn'}>
                    <div class="mt-2 h-1.5 rounded bg-black/50 overflow-hidden">
                      <div class="h-full" style={{
                        width: `${Math.min(100, (q.kills / q.killTarget) * 100)}%`,
                        background: q.state === 'ReadyToTurnIn' ? '#7CFC9A' : '#ffd24a',
                      }} />
                    </div>
                    <div class="text-[11px] text-white/50 mt-1">{q.kills} / {q.killTarget} slain</div>
                  </Show>

                  <div class="mt-3">
                    <Show when={q.state === 'NotStarted'}>
                      <button type="button" class="ts-btn" disabled={busy() === q.id} onClick={() => accept(q)}>
                        {busy() === q.id ? 'Accepting…' : 'Accept trial'}
                      </button>
                    </Show>
                    <Show when={q.state === 'ReadyToTurnIn'}>
                      <button type="button" class="ts-forge" disabled={busy() === q.id} onClick={() => turnIn(q)}>
                        {busy() === q.id ? 'Turning in…' : `Turn in → learn ${disciplineName(q.discipline)}`}
                      </button>
                    </Show>
                    <Show when={q.state === 'Completed'}>
                      <span class="text-[12px]" style={{ color: '#7CFC9A' }}>✓ {disciplineName(q.discipline)} learned</span>
                    </Show>
                    <Show when={q.state === 'InProgress'}>
                      <span class="text-[12px] text-white/40">Return here once the trial is complete.</span>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      <Show when={toast()}>
        <div class="absolute top-24 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-black/85 border border-white/15 text-sm font-semibold"
          style={{ color: toast()!.color }} onClick={() => setToast(null)}>
          {toast()!.text}
        </div>
      </Show>
    </div>
  );
}

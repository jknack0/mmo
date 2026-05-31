// Discipline-management panel (S11 #13). Shows the learned disciplines, lets the
// player toggle which two are equipped, and applies the change (costs gold +
// clears the passive allocation, per ADR-0004).

import { createSignal, onMount, For, Show } from 'solid-js';
import {
  DISCIPLINES,
  ALL_DISCIPLINE_IDS,
  MAX_EQUIPPED_DISCIPLINES,
  DISCIPLINE_SWITCH_COST,
  fetchDisciplines,
  setDisciplines,
} from './disciplines.js';

export interface DisciplinePanelProps {
  token: string;
  characterId: string;
  onChanged?: () => void;
  onClose: () => void;
}

export function DisciplinePanel(props: DisciplinePanelProps) {
  const [equipped, setEquipped] = createSignal<string[]>([]);
  const [draft, setDraft] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [msg, setMsg] = createSignal<{ text: string; color: string } | null>(null);

  onMount(async () => {
    const e = await fetchDisciplines(props.token, props.characterId);
    setEquipped(e);
    setDraft(e);
  });

  function toggle(id: string) {
    const d = draft();
    if (d.includes(id)) {
      setDraft(d.filter((x) => x !== id));
    } else if (d.length < MAX_EQUIPPED_DISCIPLINES) {
      setDraft([...d, id]);
    } else {
      setMsg({ text: `Only ${MAX_EQUIPPED_DISCIPLINES} disciplines at once.`, color: '#ff9f6a' });
    }
  }

  const dirty = () => JSON.stringify([...draft()].sort()) !== JSON.stringify([...equipped()].sort());

  async function apply() {
    if (busy() || !dirty()) return;
    setBusy(true);
    const res = await setDisciplines(props.token, props.characterId, draft());
    setBusy(false);
    if (!res.ok) {
      setMsg({ text: res.error === 'insufficient-gold' ? 'Not enough gold.' : res.error, color: '#ff6a6a' });
      return;
    }
    setEquipped(res.equipped);
    setDraft(res.equipped);
    setMsg({ text: `Disciplines set · −${DISCIPLINE_SWITCH_COST}g · passives reset`, color: '#7CFC9A' });
    props.onChanged?.();
  }

  return (
    <div class="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col" style={{ 'font-family': 'var(--font-display, monospace)' }}>
      <div class="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div>
          <h2 class="ts-zone-name">Disciplines</h2>
          <p class="ts-zone-sub">Equip up to {MAX_EQUIPPED_DISCIPLINES} · switching costs {DISCIPLINE_SWITCH_COST} gold and resets passives</p>
        </div>
        <button type="button" onClick={props.onClose} class="ts-btn">Close</button>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-6">
        <div class="max-w-2xl mx-auto grid grid-cols-1 gap-3">
          <For each={ALL_DISCIPLINE_IDS}>
            {(id) => {
              const on = () => draft().includes(id);
              return (
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  class="text-left px-4 py-3 transition-all"
                  style={{
                    background: '#140e0a',
                    'box-shadow': `0 0 0 2px #080706, 0 0 0 4px ${on() ? '#ffd24a' : '#2b2420'}, 0 0 0 6px #080706`,
                  }}
                >
                  <div class="flex items-center justify-between">
                    <span class="text-sm" style={{ color: on() ? '#ffd24a' : '#e8e0d4' }}>{DISCIPLINES[id]!.name}</span>
                    <span class="text-[11px]" style={{ color: on() ? '#7CFC9A' : '#8a7f6e' }}>{on() ? 'EQUIPPED' : 'learned'}</span>
                  </div>
                  <div class="text-[11px] text-white/40 mt-1">{DISCIPLINES[id]!.skillIds.length} skills</div>
                </button>
              );
            }}
          </For>

          <button
            type="button"
            class="ts-forge mt-2"
            classList={{ 'is-disabled': busy() || !dirty() }}
            disabled={busy() || !dirty()}
            onClick={apply}
          >
            {busy() ? 'Applying…' : dirty() ? `Apply (−${DISCIPLINE_SWITCH_COST}g)` : 'No changes'}
          </button>
        </div>
      </div>

      <Show when={msg()}>
        <div class="absolute top-24 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-black/85 border border-white/15 text-sm font-semibold"
          style={{ color: msg()!.color }} onClick={() => setMsg(null)}>
          {msg()!.text}
        </div>
      </Show>
    </div>
  );
}

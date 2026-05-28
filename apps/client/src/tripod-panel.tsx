// Tripod selector panel. Lists every Pyromancy skill with its two tiers
// of three choices. Click to select; Save persists via PUT. Behavior
// change is observable in-game — the channel re-reads the loadout on the
// next Hello, so users may need to disconnect/reconnect (Back → Play)
// to fully apply changes after they're saved.

import { createSignal, createResource, For, Show } from 'solid-js';
import {
  PYROMANCY_TRIPODS_UI,
  fetchTripods,
  saveTripods,
  type TripodChoice,
  type TripodLoadout,
} from './tripods.js';

export interface TripodPanelProps {
  token: string;
  characterId: string;
  onClose: () => void;
}

const ARCHETYPE_COLOR: Record<string, string> = {
  burn: '#ff6a3a',
  direct: '#ffd24a',
  utility: '#6ab0ff',
};

function ChoiceCard(props: {
  choice: TripodChoice;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class="text-left px-3 py-2 rounded border transition-colors"
      style={{
        'border-color': props.selected
          ? props.choice.archetype
            ? ARCHETYPE_COLOR[props.choice.archetype]!
            : '#6ab0ff'
          : 'rgba(255,255,255,0.15)',
        background: props.selected
          ? 'rgba(106,176,255,0.10)'
          : 'rgba(0,0,0,0.30)',
      }}
      onClick={props.onClick}
    >
      <div class="flex items-center gap-2 mb-1">
        <span class="text-xs font-semibold text-white">{props.choice.label}</span>
        <Show when={props.choice.archetype}>
          <span
            class="text-[9px] uppercase px-1 rounded"
            style={{
              background: ARCHETYPE_COLOR[props.choice.archetype!]!,
              color: '#111',
            }}
          >
            {props.choice.archetype}
          </span>
        </Show>
      </div>
      <div class="text-[10px] text-white/60 leading-tight">{props.choice.description}</div>
    </button>
  );
}

export function TripodPanel(props: TripodPanelProps) {
  const [loadout, { mutate }] = createResource(
    () => props.characterId,
    (id) => fetchTripods(props.token, id),
    { initialValue: {} }
  );
  const [saving, setSaving] = createSignal(false);
  const [savedFlash, setSavedFlash] = createSignal(false);

  function setChoice(skillId: string, tier: 't1' | 't2', idx: number): void {
    const current: TripodLoadout = loadout() ?? {};
    const existing = current[skillId] ?? { t1: -1, t2: -1 };
    const next: TripodLoadout = {
      ...current,
      [skillId]: { ...existing, [tier]: existing[tier] === idx ? -1 : idx },
    };
    mutate(next);
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    const ok = await saveTripods(props.token, props.characterId, loadout() ?? {});
    setSaving(false);
    if (ok) {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    }
  }

  return (
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm overflow-y-auto z-30">
      <div class="max-w-[900px] mx-auto py-8 px-6">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-semibold text-white">Tripods</h2>
            <p class="text-sm text-white/60">
              Pick one Tier 1 + one Tier 2 per skill. Click a selected choice again to clear it.
            </p>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-sm"
              onClick={props.onClose}
            >
              Close
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded bg-[color:var(--color-brand)] text-black text-sm font-semibold disabled:opacity-50"
              disabled={saving()}
              onClick={handleSave}
            >
              {saving() ? 'Saving…' : savedFlash() ? 'Saved ✓' : 'Save'}
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-4">
          <For each={Object.entries(PYROMANCY_TRIPODS_UI)}>
            {([skillId, tripod]) => {
              const sel = () => (loadout() ?? {})[skillId] ?? { t1: -1, t2: -1 };
              return (
                <div class="bg-[color:var(--color-panel)] border border-white/10 rounded p-4">
                  <div class="text-sm font-semibold text-white mb-2">{tripod.skillLabel}</div>
                  <div class="grid grid-cols-3 gap-2 mb-2">
                    <For each={tripod.t1}>
                      {(choice, idx) => (
                        <ChoiceCard
                          choice={choice}
                          selected={sel().t1 === idx()}
                          onClick={() => setChoice(skillId, 't1', idx())}
                        />
                      )}
                    </For>
                  </div>
                  <div class="grid grid-cols-3 gap-2">
                    <For each={tripod.t2}>
                      {(choice, idx) => (
                        <ChoiceCard
                          choice={choice}
                          selected={sel().t2 === idx()}
                          onClick={() => setChoice(skillId, 't2', idx())}
                        />
                      )}
                    </For>
                  </div>
                </div>
              );
            }}
          </For>
        </div>

        <div class="text-xs text-white/40 mt-4 text-center">
          Changes apply when you reconnect to a channel (Back → Play).
        </div>
      </div>
    </div>
  );
}

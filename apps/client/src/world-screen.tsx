// World-screen Solid wrapper. Calls /connect, then mounts the PixiJS scene
// into a div on first render. Hosts the HUD (HP/Spirit/Wrath bars +
// skill bar) as plain Solid markup per ADR-0012.

import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import type { Character } from './character-client.js';
import { connect } from './network/gateway-client.js';
import { mountWorldScene, type LocalPlayerStats } from './world/world-scene.js';

export interface WorldScreenProps {
  sessionToken: string;
  character: Character;
  onLeave: () => void;
  onLogout: () => void;
}

const DEFAULT_STATS: LocalPlayerStats = {
  spirit: 100,
  maxSpirit: 100,
  wrath: 0,
  maxWrath: 100,
};

function ResourceBar(props: {
  label: string;
  current: number;
  max: number;
  fillFrom: string;
  fillTo: string;
}) {
  const pct = () => Math.max(0, Math.min(1, props.current / props.max));
  return (
    <div class="flex items-center gap-2">
      <span class="w-12 text-[10px] uppercase tracking-wider text-white/60">
        {props.label}
      </span>
      <div class="relative h-3 w-44 rounded bg-black/60 border border-white/10 overflow-hidden">
        <div
          class="absolute inset-y-0 left-0 transition-[width] duration-100"
          style={{
            width: `${pct() * 100}%`,
            background: `linear-gradient(90deg, ${props.fillFrom}, ${props.fillTo})`,
          }}
        />
        <div class="absolute inset-0 flex items-center justify-end pr-1.5 text-[10px] font-mono text-white/80">
          {Math.round(props.current)}/{props.max}
        </div>
      </div>
    </div>
  );
}

function SkillSlot(props: { hotkey: string; label: string; color: string }) {
  return (
    <div class="flex flex-col items-center">
      <div
        class="w-12 h-12 rounded border border-white/20 flex items-center justify-center text-xs font-semibold backdrop-blur"
        style={{ background: props.color }}
      >
        {props.label}
      </div>
      <div class="text-[10px] mt-1 text-white/60">{props.hotkey}</div>
    </div>
  );
}

export function WorldScreen(props: WorldScreenProps) {
  const [error, setError] = createSignal<string | null>(null);
  const [stats, setStats] = createSignal<LocalPlayerStats>(DEFAULT_STATS);
  let mountEl: HTMLDivElement | undefined;
  let cleanup: (() => void) | null = null;

  onMount(async () => {
    try {
      const info = await connect(props.sessionToken, props.character.id);
      if (!mountEl) return;
      cleanup = await mountWorldScene({
        container: mountEl,
        wsUrl: info.wsUrl,
        sessionToken: props.sessionToken,
        characterId: info.character.id,
        characterName: info.character.name,
        onDisconnected: () => setError('Disconnected from channel.'),
        onStats: setStats,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  });

  onCleanup(() => {
    cleanup?.();
  });

  return (
    <div class="absolute inset-0">
      <div ref={mountEl} class="absolute inset-0" />

      {/* HUD: top-left identity + controls hint */}
      <div class="absolute top-3 left-3 bg-black/60 px-3 py-2 rounded text-sm text-white/80 backdrop-blur">
        <div>
          Playing as <span class="text-white font-medium">{props.character.name}</span>
        </div>
        <div class="text-xs text-white/40">
          Click ground to move · Click mob = basic attack · Q = Spark · R = Pyroclasm
        </div>
      </div>

      {/* HUD: bottom-left resource bars */}
      <div class="absolute bottom-3 left-3 bg-black/60 px-3 py-2 rounded backdrop-blur flex flex-col gap-1.5">
        <ResourceBar
          label="Spirit"
          current={stats().spirit}
          max={stats().maxSpirit}
          fillFrom="#3a64a8"
          fillTo="#6ab0ff"
        />
        <ResourceBar
          label="Wrath"
          current={stats().wrath}
          max={stats().maxWrath}
          fillFrom="#a04a1f"
          fillTo="#ff8a3a"
        />
      </div>

      {/* HUD: bottom-center 6-slot Pyromancy hotbar */}
      <div class="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 px-3 py-2 rounded backdrop-blur flex gap-2">
        <SkillSlot hotkey="Q" label="Spark"   color="linear-gradient(180deg, #ff8a3a, #b04a1f)" />
        <SkillSlot hotkey="W" label="Cinder"  color="linear-gradient(180deg, #ff7a3a, #8a3a1f)" />
        <SkillSlot hotkey="E" label="Fireball" color="linear-gradient(180deg, #ff6a3a, #a03a1f)" />
        <SkillSlot hotkey="R" label="Pyro"    color="linear-gradient(180deg, #ffd24a, #a04a1f)" />
        <SkillSlot hotkey="A" label="Combust" color="linear-gradient(180deg, #ffa83a, #b03a1f)" />
        <SkillSlot hotkey="S" label="Meteor"  color="linear-gradient(180deg, #ff9a3a, #c03a1f)" />
      </div>

      {/* Top-right controls */}
      <div class="absolute top-3 right-3 flex gap-2">
        <button
          type="button"
          class="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-sm backdrop-blur"
          onClick={props.onLeave}
        >
          Back
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-sm backdrop-blur"
          onClick={props.onLogout}
        >
          Sign out
        </button>
      </div>

      <Show when={error()}>
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-500/20 border border-red-500/40 px-4 py-2 rounded text-sm text-red-200">
          {error()}
        </div>
      </Show>
    </div>
  );
}

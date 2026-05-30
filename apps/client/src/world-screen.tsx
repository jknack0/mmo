// World-screen Solid wrapper. Calls /connect, then mounts the PixiJS scene
// into a div on first render. Hosts the HUD (HP/Spirit/Wrath bars +
// skill bar) as plain Solid markup per ADR-0012.

import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import type { Character } from './character-client.js';
import { connect } from './network/gateway-client.js';
import { mountWorldScene, type LocalPlayerStats } from './world/world-scene.js';
import { TripodPanel } from './tripod-panel.js';
import { PassiveTreePanel } from './passive-tree-panel.js';
import { InventoryPanel } from './inventory-panel.js';

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

// Octagonal pixel resource orb (Claude Design `.ts-orb`). --fill drives liquid height.
function Orb(props: { kind: 'spirit' | 'wrath'; current: number; max: number; cap: string }) {
  const fill = () =>
    `${Math.max(0, Math.min(100, (props.current / Math.max(1, props.max)) * 100))}%`;
  return (
    <div class={`ts-orb ts-orb--${props.kind}`} style={{ '--fill': fill() }}>
      <div class="ts-orb__liquid" />
      <div class="ts-orb__gloss" />
      <div class="ts-orb__val">{Math.round(props.current)}</div>
      <div class="ts-orb__cap">{props.cap}</div>
    </div>
  );
}

// Pixel hotbar slot (`.ts-slot`). Icon framed from the 6-frame icon_skills sheet.
function SkillSlot(props: { hotkey: string; icon: number; cost: number; wrath?: boolean }) {
  return (
    <button class="ts-slot" type="button">
      <div
        class="ts-slot__icon"
        style={{
          'background-image': 'url(/assets/icon_skills.png)',
          'background-size': '600% 100%',
          'background-position': `${(props.icon / 5) * 100}% 0`,
          'background-repeat': 'no-repeat',
          'image-rendering': 'pixelated',
        }}
      />
      <div class="ts-slot__cd" />
      <div class="ts-slot__cdtext" />
      <div class="ts-slot__key">{props.hotkey}</div>
      <div class={`ts-slot__cost${props.wrath ? ' ts-slot__cost--wrath' : ''}`}>{props.cost}</div>
    </button>
  );
}

export function WorldScreen(props: WorldScreenProps) {
  const [error, setError] = createSignal<string | null>(null);
  const [stats, setStats] = createSignal<LocalPlayerStats>(DEFAULT_STATS);
  const [showTripods, setShowTripods] = createSignal(false);
  const [showPassives, setShowPassives] = createSignal(false);
  const [showInventory, setShowInventory] = createSignal(false);
  const [pickupKey, setPickupKey] = createSignal(0);
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
        onPickup: () => setPickupKey((k) => k + 1),
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

      {/* HUD: top-left zone identity */}
      <div class="absolute top-3 left-3 px-3 py-2" style={{ background: 'rgba(8,6,6,.55)' }}>
        <div class="ts-zone-name">The Sundered Reaches</div>
        <div class="ts-zone-sub">{props.character.name} · click to move · click mob = attack</div>
      </div>

      {/* HUD: bottom-left resource orbs */}
      <div class="absolute bottom-3 left-3 flex items-end gap-2">
        <Orb kind="spirit" current={stats().spirit} max={stats().maxSpirit} cap="SPIRIT" />
        <Orb kind="wrath" current={stats().wrath} max={stats().maxWrath} cap="WRATH" />
      </div>

      {/* HUD: bottom-center 6-slot Pyromancy hotbar */}
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2">
        <div class="ts-hotbar">
          <SkillSlot hotkey="Q" icon={0} cost={8} />
          <SkillSlot hotkey="W" icon={1} cost={12} />
          <SkillSlot hotkey="E" icon={2} cost={24} />
          <SkillSlot hotkey="R" icon={3} cost={100} wrath />
          <SkillSlot hotkey="A" icon={4} cost={30} />
          <SkillSlot hotkey="S" icon={5} cost={45} />
        </div>
      </div>

      {/* Top-right controls */}
      <div class="absolute top-3 right-3 flex gap-2">
        <button
          type="button"
          class="ts-btn"
          onClick={() => setShowTripods(true)}
        >
          Tripods
        </button>
        <button
          type="button"
          class="ts-btn"
          onClick={() => setShowPassives(true)}
        >
          Passives
        </button>
        <button
          type="button"
          class="ts-btn"
          onClick={() => setShowInventory(true)}
        >
          Inventory
        </button>
        <button
          type="button"
          class="ts-btn"
          onClick={props.onLeave}
        >
          Back
        </button>
        <button
          type="button"
          class="ts-btn"
          onClick={props.onLogout}
        >
          Sign out
        </button>
      </div>

      <Show when={showTripods()}>
        <TripodPanel
          token={props.sessionToken}
          characterId={props.character.id}
          onClose={() => setShowTripods(false)}
        />
      </Show>

      <Show when={showPassives()}>
        <PassiveTreePanel
          token={props.sessionToken}
          characterId={props.character.id}
          onClose={() => setShowPassives(false)}
        />
      </Show>

      <Show when={showInventory()}>
        <InventoryPanel
          token={props.sessionToken}
          characterId={props.character.id}
          refreshKey={pickupKey()}
          onClose={() => setShowInventory(false)}
        />
      </Show>

      <Show when={error()}>
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-500/20 border border-red-500/40 px-4 py-2 rounded text-sm text-red-200">
          {error()}
        </div>
      </Show>
    </div>
  );
}

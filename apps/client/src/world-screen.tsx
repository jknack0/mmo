// World-screen Solid wrapper. Calls /connect, then mounts the PixiJS scene
// into a div on first render. Replaces the previous GameplayStub.

import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import type { Character } from './character-client.js';
import { connect } from './network/gateway-client.js';
import { mountWorldScene } from './world/world-scene.js';

export interface WorldScreenProps {
  sessionToken: string;
  character: Character;
  onLeave: () => void;
  onLogout: () => void;
}

export function WorldScreen(props: WorldScreenProps) {
  const [error, setError] = createSignal<string | null>(null);
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
      <div class="absolute top-3 left-3 bg-black/60 px-3 py-2 rounded text-sm text-white/80 backdrop-blur">
        <div>
          Playing as <span class="text-white font-medium">{props.character.name}</span>
        </div>
        <div class="text-xs text-white/40">Left-click ground to move</div>
      </div>
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
        <div class="absolute bottom-3 left-1/2 -translate-x-1/2 bg-red-500/20 border border-red-500/40 px-4 py-2 rounded text-sm text-red-200">
          {error()}
        </div>
      </Show>
    </div>
  );
}

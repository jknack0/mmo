// E2E test hook (S26 #28). Exposes a deterministic driver on `window.__mmoE2E`
// so the Playwright canonical-loop test can read live world state and issue
// gameplay actions without clicking canvas pixels. Active only in dev builds or
// when the page is loaded with `?e2e=1`, so it never ships to players.

import type { WorldSceneControls, LocalPlayerStats } from './world/world-scene.js';

export interface E2EHandle {
  phase: 'login' | 'character' | 'world';
  controls?: WorldSceneControls;
  stats?: LocalPlayerStats;
  characterId?: string;
  sessionToken?: string;
}

const enabled =
  (typeof import.meta !== 'undefined' && import.meta.env?.DEV) ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).has('e2e'));

export function e2eEnabled(): boolean {
  return !!enabled;
}

export function e2eSet(patch: Partial<E2EHandle>): void {
  if (!enabled || typeof window === 'undefined') return;
  const w = window as unknown as { __mmoE2E?: E2EHandle };
  w.__mmoE2E = { ...(w.__mmoE2E ?? { phase: 'login' }), ...patch };
}

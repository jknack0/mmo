// Loot-click resolution (pure). Deciding what a click near a ground item means:
// if the player is already within pickup range, grab it instantly; otherwise walk
// toward it and let the renderer's walk-over auto-pickup finish on arrival
// (D2/PoE behavior). The server stays authoritative — it range-gates the actual
// pickup at PICKUP_RADIUS and silently rejected out-of-range clicks before this.
//
// Pure + DOM-free so it unit-tests without Pixi.

import type { Vec2 } from '@mmo/protocol';

/** Minimal ground-item shape this resolver needs. */
export interface LootClickItem {
  id: string;
  pos: Vec2;
}

export type LootClickAction =
  | { kind: 'pickup'; itemId: string }
  | { kind: 'approach'; target: Vec2 };

/** Mirrors the server's PICKUP_RADIUS (channel-server.ts): within this the
 * server accepts a pickup, so the client grabs instantly; beyond it, walk over. */
export const PICKUP_RADIUS = 1.5;

/** A click counts as "loot" if it lands within this many tiles of an item.
 * Loose enough to absorb the iso vertical offset of the gem above its tile. */
export const CLICK_PICK_RADIUS = 1.5;

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** What clicking a specific ground item should do given where the player is. */
export function lootActionFor(item: LootClickItem, playerPos: Vec2): LootClickAction {
  return dist(playerPos, item.pos) <= PICKUP_RADIUS
    ? { kind: 'pickup', itemId: item.id }
    : { kind: 'approach', target: item.pos };
}

export function resolveLootClick(
  clicked: Vec2,
  items: LootClickItem[],
  playerPos: Vec2,
): LootClickAction | null {
  let nearest: LootClickItem | null = null;
  let nearestDist = CLICK_PICK_RADIUS;
  for (const item of items) {
    const d = dist(clicked, item.pos);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = item;
    }
  }
  if (!nearest) return null;
  return lootActionFor(nearest, playerPos);
}

// Pure isometric coordinate math. Salvaged from the validated spike per
// PROTOTYPE_NOTES.md but isolated as a deep module so the renderer / input
// systems consume a single interface.

import type { Vec2 } from '@mmo/protocol';

/** Tile width in screen pixels (top-down diamond width). */
export const ISO_TILE_W = 64;
/** Tile height in screen pixels (top-down diamond height). */
export const ISO_TILE_H = 32;

export function tileToScreen(t: Vec2): Vec2 {
  return {
    x: (t.x - t.y) * (ISO_TILE_W / 2),
    y: (t.x + t.y) * (ISO_TILE_H / 2),
  };
}

export function screenToTile(s: Vec2): Vec2 {
  return {
    x: (s.x / (ISO_TILE_W / 2) + s.y / (ISO_TILE_H / 2)) / 2,
    y: (s.y / (ISO_TILE_H / 2) - s.x / (ISO_TILE_W / 2)) / 2,
  };
}

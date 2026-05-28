import { describe, it, expect } from 'vitest';
import { tileToScreen, screenToTile, ISO_TILE_W, ISO_TILE_H } from './iso-coords.js';

describe('iso-coords', () => {
  it('tile (0,0) maps to screen (0,0)', () => {
    expect(tileToScreen({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('tile (1,0) shifts right by half a tile width and down by half a tile height', () => {
    expect(tileToScreen({ x: 1, y: 0 })).toEqual({
      x: ISO_TILE_W / 2,
      y: ISO_TILE_H / 2,
    });
  });

  it('tile (0,1) shifts left by half a tile width and down by half a tile height', () => {
    expect(tileToScreen({ x: 0, y: 1 })).toEqual({
      x: -ISO_TILE_W / 2,
      y: ISO_TILE_H / 2,
    });
  });

  it('round-trips tile → screen → tile within float precision', () => {
    const cases = [
      { x: 5, y: 7 },
      { x: 0, y: 0 },
      { x: 12.5, y: 3.25 },
    ];
    for (const t of cases) {
      const s = tileToScreen(t);
      const t2 = screenToTile(s);
      expect(t2.x).toBeCloseTo(t.x, 5);
      expect(t2.y).toBeCloseTo(t.y, 5);
    }
  });
});

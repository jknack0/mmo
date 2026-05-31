import { describe, it, expect } from 'vitest';
import {
  parseManifest,
  frameRects,
  frameIndex,
  mobRender,
  allMobSheets,
  isDirectionalSheet,
  animFrameIndex,
  DIR_FRAMES,
  FACING_SOUTH,
  PLAYER_SHEET,
} from './asset-manifest.js';

const RAW = {
  defaults: { rows: 1, renderScale: 2 },
  sheets: {
    'mob_skeleton_base.png': { cols: 8, rows: 1, cellW: 16, cellH: 19, frames: [...DIR_FRAMES], anchor: [0.5, 0.95], renderScale: 2 },
    'icon_skills.png': { cols: 6, cellW: 16, cellH: 16, frames: ['spark', 'cinder', 'fireball', 'pyroclasm', 'combust', 'meteor'], renderScale: 2 },
    'fx_veilwisp.png': { cols: 2, cellW: 7, cellH: 8, frames: ['bob_a', 'bob_b'], renderScale: 3, fps: 6 },
  },
};

describe('asset manifest (pure)', () => {
  it('parses sheets and applies defaults', () => {
    const m = parseManifest(RAW);
    expect(m.sheets['mob_skeleton_base.png']!.cols).toBe(8);
    expect(m.sheets['icon_skills.png']!.rows).toBe(1);        // from defaults
    expect(m.sheets['icon_skills.png']!.anchor).toEqual([0.5, 0.95]); // default anchor
    expect(m.sheets['fx_veilwisp.png']!.fps).toBe(6);
  });

  it('handles an empty / missing manifest without throwing', () => {
    expect(parseManifest(undefined).sheets).toEqual({});
    expect(parseManifest({}).sheets).toEqual({});
  });

  it('computes one frame rect per cell in row-major order', () => {
    const m = parseManifest(RAW);
    const rects = frameRects(m.sheets['mob_skeleton_base.png']!);
    expect(rects).toHaveLength(8);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 16, h: 19 });
    expect(rects[2]).toEqual({ x: 32, y: 0, w: 16, h: 19 });
  });

  it('resolves named frames (facing + skill icon) with a safe fallback', () => {
    const m = parseManifest(RAW);
    expect(frameIndex(m.sheets['mob_skeleton_base.png']!, 's')).toBe(FACING_SOUTH);
    expect(frameIndex(m.sheets['icon_skills.png']!, 'fireball')).toBe(2);
    expect(frameIndex(m.sheets['icon_skills.png']!, 'nonexistent')).toBe(0); // fallback
  });

  it('maps mob kinds to sheets + scale, skeleton-lord is the up-scaled brute', () => {
    expect(mobRender('skeleton')).toEqual({ sheet: 'mob_skeleton_base.png', scale: 2 });
    expect(mobRender('ghoul').sheet).toBe('mob_ghoul.png');
    expect(mobRender('bonecaster').sheet).toBe('mob_bonecaster_8dir.png');
    expect(mobRender('skeleton-lord').scale).toBeGreaterThan(mobRender('skeleton').scale);
    expect(mobRender('totally-unknown')).toEqual(mobRender('skeleton')); // fallback
  });

  it('lists the distinct mob sheets to preload, plus the player sheet const', () => {
    expect(allMobSheets()).toEqual(expect.arrayContaining(['mob_skeleton_base.png', 'mob_ghoul.png', 'mob_bonecaster_8dir.png']));
    expect(PLAYER_SHEET).toBe('hero_pyromancer_idle_8dir.png');
  });
});

describe('animation / facing frame selection (S-anim)', () => {
  const m = parseManifest(RAW);
  const dir = m.sheets['mob_skeleton_base.png']!;   // 8 facings
  const loop = m.sheets['fx_veilwisp.png']!;        // 2-frame, fps 6

  it('detects directional (8-dir) sheets vs animation loops', () => {
    expect(isDirectionalSheet(dir)).toBe(true);
    expect(isDirectionalSheet(loop)).toBe(false);
    expect(isDirectionalSheet(m.sheets['icon_skills.png']!)).toBe(false);
  });

  it('directional sheets pick the facing frame (clamped)', () => {
    expect(animFrameIndex({ frameCount: 8, directional: true, facing: 0 }, 9999)).toBe(0);   // east
    expect(animFrameIndex({ frameCount: 8, directional: true, facing: FACING_SOUTH }, 0)).toBe(FACING_SOUTH);
    expect(animFrameIndex({ frameCount: 8, directional: true, facing: 99 }, 0)).toBe(7);      // clamp
    expect(animFrameIndex({ frameCount: 8, directional: true }, 0)).toBe(FACING_SOUTH);       // default
  });

  it('fps sheets loop over time, modulo frame count', () => {
    const sel = { frameCount: 2, fps: 6, directional: false };
    expect(animFrameIndex(sel, 0)).toBe(0);
    expect(animFrameIndex(sel, 170)).toBe(1);     // ~1 frame at 6fps (166ms)
    expect(animFrameIndex(sel, 340)).toBe(0);     // wraps
  });

  it('a single-frame or fps-less sheet is always frame 0', () => {
    expect(animFrameIndex({ frameCount: 1, fps: 9, directional: false }, 500)).toBe(0);
    expect(animFrameIndex({ frameCount: 4, directional: false }, 500)).toBe(0); // no fps
  });
});

import { describe, it, expect } from 'vitest';
import {
  parseManifest,
  frameRects,
  frameIndex,
  mobRender,
  allMobSheets,
  isDirectionalSheet,
  animFrameIndex,
  clipFrameIndex,
  attackDuration,
  tryTriggerAttack,
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
    // Multi-row clip sheet: idle (rows 0-7) + move (rows 8-15), cols = max frames.
    'mob_skeleton_base_clips.png': {
      cols: 4, rows: 16, cellW: 16, cellH: 19, frames: [...DIR_FRAMES], anchor: [0.5, 0.95], renderScale: 2,
      clips: { idle: { frames: 2, fps: 3, row: 0 }, move: { frames: 4, fps: 8, row: 8 } },
    },
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

describe('clip-aware frame selection (idle/move/attack)', () => {
  const m = parseManifest(RAW);
  const clip = m.sheets['mob_skeleton_base_clips.png']!; // idle@row0 (2f), move@row8 (4f), cols 4
  const legacyDir = m.sheets['mob_skeleton_base.png']!;  // single-row 8-dir, no clips
  const legacyLoop = m.sheets['fx_veilwisp.png']!;       // 2-frame fps loop, no clips

  it('parses the clips map (frames/fps/row per state)', () => {
    expect(clip.clips).toBeDefined();
    expect(clip.clips!.idle).toEqual({ frames: 2, fps: 3, row: 0 });
    expect(clip.clips!.move).toEqual({ frames: 4, fps: 8, row: 8 });
    expect(clip.clips!.attack).toBeUndefined();
    // Legacy sheets carry no clips.
    expect(legacyDir.clips).toBeUndefined();
  });

  it('indexes a clip frame by (clip.row + facing) * cols + frame', () => {
    // idle@row0, cols 4 → facing picks the row, frame 0 at t=0.
    expect(clipFrameIndex(clip, 'idle', 0, 0)).toBe(0);          // east:  (0+0)*4
    expect(clipFrameIndex(clip, 'idle', FACING_SOUTH, 0)).toBe(8); // south: (0+2)*4
    expect(clipFrameIndex(clip, 'idle', 7, 0)).toBe(28);         // ne:    (0+7)*4
  });

  it('loops a move clip over time, modulo its frame count', () => {
    // move@row8, cols 4, 4 frames @ 8fps (125ms/frame), facing south → base row 10 → 40.
    expect(clipFrameIndex(clip, 'move', FACING_SOUTH, 0)).toBe(40);   // frame 0
    expect(clipFrameIndex(clip, 'move', FACING_SOUTH, 130)).toBe(41); // frame 1
    expect(clipFrameIndex(clip, 'move', FACING_SOUTH, 390)).toBe(43); // frame 3
    expect(clipFrameIndex(clip, 'move', FACING_SOUTH, 520)).toBe(40); // wraps to 0
  });

  it('degrades a missing clip to idle', () => {
    // No attack block on this sheet → falls back to idle (row 0).
    expect(clipFrameIndex(clip, 'attack', FACING_SOUTH, 999)).toBe(8); // = idle south frame 0
  });

  it('legacy 8-dir sheets ignore state and pick the facing frame', () => {
    // Single-row 8-dir, no clips: facing selects the column, state is irrelevant.
    expect(clipFrameIndex(legacyDir, 'move', 0, 9999)).toBe(0);
    expect(clipFrameIndex(legacyDir, 'idle', FACING_SOUTH, 0)).toBe(FACING_SOUTH);
    expect(clipFrameIndex(legacyDir, 'attack', 7, 0)).toBe(7);
  });

  it('legacy loop sheets time-loop; single/no-clip sheets stay on frame 0', () => {
    expect(clipFrameIndex(legacyLoop, 'idle', FACING_SOUTH, 0)).toBe(0);
    expect(clipFrameIndex(legacyLoop, 'idle', FACING_SOUTH, 170)).toBe(1); // 6fps → frame 1
    expect(clipFrameIndex(m.sheets['icon_skills.png']!, 'idle', 0, 500)).toBe(0); // no fps → static
  });
});

describe('attack one-shot helpers (pure)', () => {
  const m = parseManifest(RAW);
  const clip = m.sheets['mob_skeleton_base_clips.png']!;  // no attack clip
  const legacy = m.sheets['mob_skeleton_base.png']!;       // no clips at all

  // A mock meta with an attack clip (4 frames @ 12fps = 333ms).
  const withAttack = {
    key: 'test', cols: 4, rows: 24, cellW: 16, cellH: 19,
    frames: [...DIR_FRAMES], anchor: [0.5, 0.95] as [number, number], renderScale: 2,
    clips: { attack: { frames: 4, fps: 12, row: 16 } },
  };

  it('attackDuration returns ms from clip meta, 0 when absent', () => {
    expect(attackDuration(withAttack)).toBeCloseTo(333, -1); // 4/12*1000 = 333ms
    expect(attackDuration(clip)).toBe(0); // no attack clip
    expect(attackDuration(legacy)).toBe(0); // no clips at all
    expect(attackDuration(undefined)).toBe(0);
  });

  it('tryTriggerAttack sets attackUntil when a clip exists and actor is not attacking', () => {
    const now = 5000;
    const result = tryTriggerAttack(0, withAttack, now);
    expect(result.triggered).toBe(true);
    expect(result.attackUntil).toBeGreaterThan(now);
    expect(result.attackUntil).toBeCloseTo(now + 333, -1);
  });

  it('tryTriggerAttack ignores re-trigger while already mid-attack', () => {
    const now = 5000;
    const midAttack = now + 200; // 200ms left on current attack
    const result = tryTriggerAttack(midAttack, withAttack, now);
    expect(result.triggered).toBe(false);
    expect(result.attackUntil).toBe(midAttack); // unchanged
  });

  it('tryTriggerAttack returns false (no-op) when the actor has no attack clip', () => {
    const now = 5000;
    expect(tryTriggerAttack(0, clip, now).triggered).toBe(false);
    expect(tryTriggerAttack(0, legacy, now).triggered).toBe(false);
    expect(tryTriggerAttack(0, null, now).triggered).toBe(false);
    expect(tryTriggerAttack(0, undefined, now).triggered).toBe(false);
  });

  it('tryTriggerAttack re-triggers after the previous attack ends', () => {
    const now = 5000;
    const prevAttackEnded = now - 1; // ended just before now
    const result = tryTriggerAttack(prevAttackEnded, withAttack, now);
    expect(result.triggered).toBe(true);
    expect(result.attackUntil).toBeCloseTo(now + 333, -1);
  });

  it('clipFrameIndex uses facing 0 for single-facing clip sheets', () => {
    // Simulate a front-only flyer: frames=['s'], clips on single-row blocks.
    const singleFacing = {
      key: 'flyer', cols: 4, rows: 3, cellW: 16, cellH: 16,
      frames: ['s'], anchor: [0.5, 0.95] as [number, number], renderScale: 2,
      clips: {
        idle: { frames: 2, fps: 3, row: 0 },
        move: { frames: 4, fps: 8, row: 1 },
        attack: { frames: 4, fps: 12, row: 2 },
      },
    };
    // cols=4. Facing=south=2, but since frames.length < 8, rf=0.
    // So row = clip.row + 0 = clip.row.
    expect(clipFrameIndex(singleFacing, 'idle', 2, 0)).toBe(0);     // (0+0)*4+0
    expect(clipFrameIndex(singleFacing, 'move', 5, 130)).toBe(5);    // (1+0)*4+1
    expect(clipFrameIndex(singleFacing, 'attack', 7, 0)).toBe(8);    // (2+0)*4+0
  });
});

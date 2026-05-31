// Asset manifest (pure). Parses the artist-authored spritesheet_map.json into a
// typed model and answers the lookups the runtime registry needs: per-sheet
// frame rectangles, mob-kind → sheet/scale mapping, and skill-icon indices.
//
// Pure + side-effect free so it unit-tests without PixiJS. The runtime loader
// (asset-registry.ts) fetches the JSON, feeds it here, and turns the rectangles
// into GPU textures.

/** Animation states an actor sheet can carry (S-anim clips). */
export type ClipState = 'idle' | 'move' | 'attack';

/**
 * One animation clip on a multi-row actor sheet. The clip occupies an
 * 8-facing block of rows starting at `row` (one row per facing, frame order
 * [e,se,s,sw,w,nw,n,ne]); `frames` columns wide, looped at `fps`.
 */
export interface ClipMeta {
  frames: number;
  fps: number;
  /** Starting row of this clip's 8-facing block (idle 0, move 8, attack 16). */
  row: number;
}

/** Canonical row order for clip blocks when a manifest omits explicit rows. */
export const CLIP_ORDER: ClipState[] = ['idle', 'move', 'attack'];

export interface SheetMeta {
  /** File under /assets, the sheet key itself. */
  key: string;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  /** Ordered frame names. For 8-dir sheets: [e,se,s,sw,w,nw,n,ne]. */
  frames: string[];
  /** Sprite anchor (feet-anchored for actors). */
  anchor: [number, number];
  /** Integer upscale applied in-engine (art is native-res). */
  renderScale: number;
  /** Animation rate for looped sheets (fx), if any. */
  fps?: number;
  /**
   * Per-state animation clips (idle/move/attack), each an 8-facing × frames
   * block. Absent on legacy single-row sheets, which behave as a static idle.
   */
  clips?: Partial<Record<ClipState, ClipMeta>>;
}

export interface SpriteManifest {
  sheets: Record<string, SheetMeta>;
}

interface RawClip { frames?: number; fps?: number; row?: number; }
interface RawSheet {
  cols?: number; rows?: number; cellW?: number; cellH?: number;
  frames?: string[]; anchor?: [number, number]; renderScale?: number; fps?: number;
  clips?: Partial<Record<ClipState, RawClip>>;
}
interface RawManifest {
  defaults?: { rows?: number; renderScale?: number };
  sheets?: Record<string, RawSheet>;
}

/** Frame index order for 8-direction actor sheets. */
export const DIR_FRAMES = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'] as const;
export const FACING_SOUTH = DIR_FRAMES.indexOf('s'); // 2 — default toward camera

/** Parse + normalise the raw JSON into a typed manifest (defaults applied). */
export function parseManifest(raw: unknown): SpriteManifest {
  const r = (raw ?? {}) as RawManifest;
  const sheets: Record<string, SheetMeta> = {};
  for (const [key, s] of Object.entries(r.sheets ?? {})) {
    sheets[key] = {
      key,
      cols: s.cols ?? 1,
      rows: s.rows ?? r.defaults?.rows ?? 1,
      cellW: s.cellW ?? 16,
      cellH: s.cellH ?? 16,
      frames: s.frames ?? [],
      anchor: s.anchor ?? [0.5, 0.95],
      renderScale: s.renderScale ?? r.defaults?.renderScale ?? 2,
      fps: s.fps,
      ...(s.clips ? { clips: parseClips(s.clips) } : {}),
    };
  }
  return { sheets };
}

/** Normalise raw clips: fill missing `row` from the canonical block order. */
function parseClips(raw: Partial<Record<ClipState, RawClip>>): Partial<Record<ClipState, ClipMeta>> {
  const out: Partial<Record<ClipState, ClipMeta>> = {};
  for (const state of CLIP_ORDER) {
    const c = raw[state];
    if (!c) continue;
    out[state] = {
      frames: c.frames ?? 1,
      fps: c.fps ?? 0,
      row: c.row ?? CLIP_ORDER.indexOf(state) * 8,
    };
  }
  return out;
}

export interface FrameRect { x: number; y: number; w: number; h: number; }

/** Pixel rectangles for each cell of a sheet (row-major; rows default 1). */
export function frameRects(meta: SheetMeta): FrameRect[] {
  const out: FrameRect[] = [];
  for (let row = 0; row < meta.rows; row++) {
    for (let col = 0; col < meta.cols; col++) {
      out.push({ x: col * meta.cellW, y: row * meta.cellH, w: meta.cellW, h: meta.cellH });
    }
  }
  return out;
}

/** Resolve a named frame to its index (e.g. a facing 's' or a skill 'fireball'). */
export function frameIndex(meta: SheetMeta, name: string): number {
  const i = meta.frames.indexOf(name);
  return i >= 0 ? i : 0;
}

/** A sheet whose frames are the 8 facings (vs. a time-animated loop). */
export function isDirectionalSheet(meta: SheetMeta): boolean {
  return meta.frames.length >= 8 && DIR_FRAMES.every((d, i) => meta.frames[i] === d);
}

export interface AnimSelect {
  frameCount: number;
  /** Loop rate for non-directional sheets; 0/undefined = static. */
  fps?: number;
  /** True when frames are facings (pick by `facing`, no time loop). */
  directional: boolean;
  /** Current facing 0..7 (only used when directional). */
  facing?: number;
}

/**
 * Which frame to display now. Directional sheets pick the facing frame;
 * fps sheets loop over time; everything else is the first frame. Pure so the
 * renderer stays a thin caller (S-anim).
 */
export function animFrameIndex(sel: AnimSelect, elapsedMs: number): number {
  if (sel.frameCount <= 0) return 0;
  if (sel.directional) {
    const f = sel.facing ?? FACING_SOUTH;
    return Math.min(Math.max(f, 0), sel.frameCount - 1);
  }
  return loopFrame(sel.fps ?? 0, sel.frameCount, elapsedMs);
}

/** Frame within a looped clip: time→index, static (0) when fps≤0 or ≤1 frame. */
function loopFrame(fps: number, count: number, elapsedMs: number): number {
  if (count <= 1 || fps <= 0) return 0;
  return Math.floor((elapsedMs / 1000) * fps) % count;
}

/**
 * Flat index into the sliced texture array for an actor showing `state` while
 * `facing`, at `elapsedMs` into the current clip. Unifies the clip model with
 * legacy sheets so the renderer is a thin caller:
 *  - clip sheet  → (clip.row + facing) * cols + loopFrame(fps, frames)  [facing = row]
 *  - legacy 8-dir → facing                                              [facing = col]
 *  - legacy loop → time-loop over frames; single → 0
 * A requested clip that's missing degrades to idle, then to frame 0.
 */
export function clipFrameIndex(
  meta: SheetMeta,
  state: ClipState,
  facing: number,
  elapsedMs: number
): number {
  const f = Math.min(Math.max(facing, 0), 7);
  const clip = meta.clips?.[state] ?? meta.clips?.idle;
  if (clip) {
    return (clip.row + f) * meta.cols + loopFrame(clip.fps, clip.frames, elapsedMs);
  }
  // Legacy sheets: 8-dir picks the facing frame; everything else time-loops.
  if (isDirectionalSheet(meta)) return Math.min(f, meta.frames.length - 1);
  return loopFrame(meta.fps ?? 0, meta.frames.length, elapsedMs);
}

// ─── Mob kind → sheet + render scale ────────────────────────────
export interface MobRender { sheet: string; scale: number; }

const MOB_SHEETS: Record<string, MobRender> = {
  skeleton: { sheet: 'mob_skeleton_base.png', scale: 2 },
  'skeleton-lord': { sheet: 'mob_skeleton_base.png', scale: 2.6 }, // brute (Rift boss)
  ghoul: { sheet: 'mob_ghoul.png', scale: 2 },
  bonecaster: { sheet: 'mob_bonecaster_8dir.png', scale: 2 },
  cinderbat: { sheet: 'mob_cinderbat_fly_s.png', scale: 2 }, // flyer (front-facing flap)
  cyclops: { sheet: 'boss_cyclops_s.png', scale: 2.6 }, // one-eyed stone-giant boss
};

/** Sheet + scale for a mob kind; unknown kinds fall back to the skeleton. */
export function mobRender(kind: string): MobRender {
  return MOB_SHEETS[kind] ?? MOB_SHEETS.skeleton!;
}

export const PLAYER_SHEET = 'hero_pyromancer_idle_8dir.png';
export const ICON_SHEET = 'icon_skills.png';

/** Every sheet a mob kind can reference — for preloading. */
export function allMobSheets(): string[] {
  return [...new Set(Object.values(MOB_SHEETS).map((m) => m.sheet))];
}

// Asset manifest (pure). Parses the artist-authored spritesheet_map.json into a
// typed model and answers the lookups the runtime registry needs: per-sheet
// frame rectangles, mob-kind → sheet/scale mapping, and skill-icon indices.
//
// Pure + side-effect free so it unit-tests without PixiJS. The runtime loader
// (asset-registry.ts) fetches the JSON, feeds it here, and turns the rectangles
// into GPU textures.

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
}

export interface SpriteManifest {
  sheets: Record<string, SheetMeta>;
}

interface RawSheet {
  cols?: number; rows?: number; cellW?: number; cellH?: number;
  frames?: string[]; anchor?: [number, number]; renderScale?: number; fps?: number;
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
    };
  }
  return { sheets };
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

// ─── Mob kind → sheet + render scale ────────────────────────────
export interface MobRender { sheet: string; scale: number; }

const MOB_SHEETS: Record<string, MobRender> = {
  skeleton: { sheet: 'mob_skeleton_base.png', scale: 2 },
  'skeleton-lord': { sheet: 'mob_skeleton_base.png', scale: 2.6 }, // brute (Rift boss)
  ghoul: { sheet: 'mob_ghoul.png', scale: 2 },
  bonecaster: { sheet: 'mob_bonecaster_8dir.png', scale: 2 },
  cinderbat: { sheet: 'mob_cinderbat_fly_s.png', scale: 2 }, // flyer (front-facing flap)
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

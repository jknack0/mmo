// Asset registry (runtime). Fetches the sprite manifest, loads every sheet via
// PixiJS, slices each into per-frame textures, and answers
// player/mob/icon lookups. A missing or failed sheet degrades to a tinted
// placeholder texture so the world always renders — generated PNGs can land one
// at a time and light up automatically on the next load.

import { Assets, Texture, Rectangle, TextureSource } from 'pixi.js';
import {
  parseManifest,
  frameRects,
  frameIndex,
  mobRender,
  isDirectionalSheet,
  PLAYER_SHEET,
  ICON_SHEET,
  type SheetMeta,
  type SpriteManifest,
} from './asset-manifest.js';

const MANIFEST_URL = '/assets/spritesheet_map.json';
const ASSET_BASE = '/assets/';

export interface MobFrames {
  frames: Texture[];
  scale: number;
  anchor: [number, number];
  /** Loop rate for a time-animated sheet (cinderbat flap, cyclops breathe). */
  fps?: number;
  /** True when frames are the 8 facings (skeleton/ghoul/bonecaster). */
  directional: boolean;
}

export interface AssetRegistry {
  manifest: SpriteManifest;
  /** True for sheets that actually loaded (vs. placeholder fallback). */
  loaded(sheetKey: string): boolean;
  meta(sheetKey: string): SheetMeta | undefined;
  frames(sheetKey: string): Texture[];
  playerFrames(): Texture[];
  mobFrames(kind: string): MobFrames;
  icon(name: string): Texture | undefined;
}

/** A 1×1 magenta texture — obvious "asset missing" marker, tintable by sprites. */
let placeholderTex: Texture | null = null;
function placeholder(): Texture {
  if (placeholderTex) return placeholderTex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (ctx) { ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, 1, 1); }
  placeholderTex = Texture.from(canvas);
  return placeholderTex;
}

function sliceSheet(src: Texture, meta: SheetMeta): Texture[] {
  src.source.scaleMode = 'nearest';
  return frameRects(meta).map(
    (r) => new Texture({ source: src.source, frame: new Rectangle(r.x, r.y, r.w, r.h) })
  );
}

export async function loadAssetRegistry(): Promise<AssetRegistry> {
  TextureSource.defaultOptions.scaleMode = 'nearest';

  let manifest: SpriteManifest = { sheets: {} };
  try {
    const res = await fetch(MANIFEST_URL);
    if (res.ok) manifest = parseManifest(await res.json());
  } catch {
    // No manifest — everything will placeholder.
  }

  const framesByKey = new Map<string, Texture[]>();
  const okByKey = new Map<string, boolean>();

  await Promise.all(
    Object.values(manifest.sheets).map(async (meta) => {
      try {
        const tex = (await Assets.load(`${ASSET_BASE}${meta.key}`)) as Texture;
        framesByKey.set(meta.key, sliceSheet(tex, meta));
        okByKey.set(meta.key, true);
      } catch {
        const n = Math.max(1, meta.frames.length || meta.cols);
        framesByKey.set(meta.key, Array.from({ length: n }, () => placeholder()));
        okByKey.set(meta.key, false);
      }
    })
  );

  function frames(sheetKey: string): Texture[] {
    return framesByKey.get(sheetKey) ?? [placeholder()];
  }

  return {
    manifest,
    loaded: (k) => okByKey.get(k) === true,
    meta: (k) => manifest.sheets[k],
    frames,
    playerFrames: () => frames(PLAYER_SHEET),
    mobFrames(kind) {
      const r = mobRender(kind);
      const m = manifest.sheets[r.sheet];
      return {
        frames: frames(r.sheet),
        scale: r.scale,
        anchor: m?.anchor ?? [0.5, 0.95],
        fps: m?.fps,
        directional: m ? isDirectionalSheet(m) : false,
      };
    },
    icon(name) {
      const m = manifest.sheets[ICON_SHEET];
      if (!m) return undefined;
      return frames(ICON_SHEET)[frameIndex(m, name)];
    },
  };
}

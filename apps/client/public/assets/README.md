# Asset drop folder

Generated sprites live here and load automatically through the manifest-driven
registry (`src/world/asset-manifest.ts` + `asset-registry.ts`). Drop a PNG +
add its entry to `spritesheet_map.json` and it lights up on the next reload. Any
sheet that isn't authored yet renders a magenta placeholder — the world never
breaks.

## Rules (Art Bible)
- Transparent PNG, **native pixel resolution** (1 texel = 1 art pixel). The
  engine sets `scaleMode = NEAREST` and integer-upscales via `renderScale`.
- Actor/mob sheets are **horizontal strips**, frame order `[e, se, s, sw, w,
  nw, n, ne]` (sw/w/nw are horizontal mirrors of se/e/ne).
- Anchor **feet** (`[0.5, 0.95]`) for actors; standing on a 64×32 iso diamond.
- Terrain tiles fill a 64×32 diamond exactly.
- Palette per the ember/ash bible; rarity rims are tinted in-engine — keep item
  art **white base**.

## Adding a sheet
1. Save `your_sheet.png` here.
2. Add to `spritesheet_map.json` under `sheets`:
   ```json
   "your_sheet.png": {
     "cols": 8, "rows": 1, "cellW": 16, "cellH": 19,
     "frames": ["e","se","s","sw","w","nw","n","ne"],
     "anchor": [0.5, 0.95], "renderScale": 2
   }
   ```
3. For a new **mob kind**, add a `kind → sheet` row to `MOB_SHEETS` in
   `asset-manifest.ts` (server mob `kind` strings: `skeleton`, `skeleton-lord`,
   `ghoul`, `bonecaster`).

## Manifest slots wanted (priority order)
- `tile_*` terrain diamonds (ground / cracked / scorched / town / rift)
- `player_blademaster_8dir.png` (Blademaster has no sheet yet)
- `npc_vendor` · `npc_trainer_pyro` · `npc_trainer_blade` · `portal_rift`
- `mob_skeleton_lord` dedicated boss sheet (currently the up-scaled skeleton)
- `icon_*` item icons (weapons / armor / jewelry / potion) for the bag grid

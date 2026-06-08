# Hero / Pyromancer — AI-Generator Route (#70)

## Generation Prompt

> **Subject:** A humanoid pyromancer in dark gothic style — asymmetric silhouette with a fiery orb
> floating near one hand. Robed figure, hood or cowl optional, the orb is the focal glow element.
> **Native size:** 16×21 pixels per frame (cell size). Export at 2× upscale for review.
> **View/angle:** 5 distinct views — east, south-east, south, north, north-east.
> Author these as separate cells; the engine mirrors se/e/ne → sw/w/nw.
> **Palette:** Only use tokens from `apps/client/src/styles/tokens.css`:
>   - Bone/base: `#d8cdbb`, `#f0deba` (hi), `#8a7f6e` (sh)
>   - Robe: `#2b2420` (band), `#13100d` (inner), `#5a4d36` (bevel)
>   - Fire orb: `#fff1c4` (core), `#ff9f1a` (mid), `#b0301a` (coal)
>   - Outline: `#08080b` (ink)
>   - Background: transparent (the void is the canvas fill, never an asset)
> **Explicitly avoid:** blur, anti-aliased edges, off-grid pixels, extra colours beyond the
> token palette, 3D rendering, realistic proportions (this is pixel art).
> **Animation states needed (all 8 facings, 4 frames per column):**
>   - idle (rows 0–7): 2 frames @ 3fps — subtle breathing, orb bobbing gently
>   - move (rows 8–15): 4 frames @ 8fps — walking stride, robe motion, orb trails behind
>   - attack (rows 16–23): 4 frames @ 12fps — casting pose, orb pushed forward, bright flash
> **Output format:** Transparent PNG spritesheet laid out as a clip sheet:
>   cols=4 (frames), rows=24 (idle 8 + move 8 + attack 8), cellW=16, cellH=21.
>   Frame order in each row block: [e, se, s, sw, w, nw, n, ne].
>   Mirror left-facing views (sw/w/nw) from their right-side counterparts.
>   Anchor: bottom-centre [0.5, 0.95] (feet-anchored for iso projection).
>   Render scale: 2× (engine upscales integer-nearest).

## Cleanup Checklist

After generating the raw output, apply these steps before shipping:

- [ ] Downscale to native 16×21 pixel cells (remove any upscale)
- [ ] Reduce to the exact token palette above — no intermediate or blended colours
- [ ] Fix any off-grid pixels: all texels must sit cleanly on the 1px grid
- [ ] Hard-outline every frame with `#08080b` — no anti-aliased edges
- [ ] Slice into the 5 authored views (e, se, s, n, ne)
- [ ] Mirror se→sw, e→w, ne→nw using `Image.transpose(Image.FLIP_LEFT_RIGHT)`
- [ ] Assemble rows: idle block (facing order e/se/s/sw/w/nw/n/ne, cols=frames), then move block, then attack block
- [ ] Verify the orb is visible on south/east-facing views, hidden on north/back views
- [ ] Verify silhouette reads clearly at native 16×21 resolution
- [ ] Export as `hero_pyromancer_idle_8dir.png` → `apps/client/public/assets/`
- [ ] Update `spritesheet_map.json`: set `rows: 24`, add `clips.attack: { frames: 4, fps: 12, row: 16 }`
- [ ] Copy PNG + manifest to `apps/client/dist/assets/`
- [ ] Run `pnpm dev` and verify the hero animates idle/move/attack in-world
- [ ] Run `pnpm test` — all existing tests must pass

---
name: sundered-sprites
description: >-
  Generate on-style pixel-art assets for The Sundered Reaches — enemies, NPCs, items,
  skill/inventory icons, tiles, recolor variants, and procedural-FX code — all matched to
  the game's tokens, sizing, 8-direction, and iso conventions. Use this skill whenever the
  user wants to create, add, generate, draw, recolor, or batch-produce ANY game art asset
  (a monster, boss, flyer, item, icon, tile, sprite sheet, animation, or effect), extend the
  spritesheet manifest, or make tier/rarity variants — even if they don't say "pixel art" or
  name the skill. Reach for it for "make me a/some <asset>", "new enemy/icon/tile", "give it a
  variant", "more assets", or anything that produces art for this game.
---

# Sundered Sprites

Produces game-ready pixel art for **The Sundered Reaches** and keeps every asset on-style.
The toolkit automates the parts that suit code; for organic art it directs the AI-generator
route instead. The deliverable is always a real PNG (or, for runtime effects, Pixi code) plus
a manifest entry — never just a script.

## Step 0 — Read the source of truth first
Before generating anything, read the repo's canonical files so the output matches the system:
- `tokens.json` / `tokens.css` — palette, sizes, bevel/glow recipes (the palette is authoritative here).
- `spritesheet_map.json` — sheet manifest + the procedural recipes.
- `README.md` — Pixi loading, iso math, drive model.
- `references/art-bible.md` (in this skill) — a condensed summary if you need orientation fast.
`scripts/spritekit.py` loads colours straight from `tokens.json` at runtime, so generated art
can't drift from the design system. If a value isn't in the repo, ask rather than invent it.

## Non-negotiable rules (these define "on-style")
1. **Pixel-perfect:** square corners, `image-rendering: pixelated`, **integer scale only**, **NEAREST** filtering, hard 2px bevels — never any blur.
2. **Authoring res:** 1 texel = 1 art pixel. Transparent PNG horizontal strips at native cell size.
3. **8-direction order is always** `[e, se, s, sw, w, nw, n, ne]`; `sw/w/nw` are horizontal mirrors of `se/e/ne`.
4. **Iso:** tile 64×32; `screen = ((tx−ty)*32, (tx+ty)*16)`; actor anchor bottom-centre `[0.5, ~0.95]`.
5. **Palette discipline:** only token colours. **Rarity colours are globally constant — never zone-tinted.** `--void` is background only, never an asset fill.
6. **PNG vs procedural:** loot beacons, fire VFX, burn flames, and terrain are drawn in-engine (Pixi) so they tint/animate — deliver these as **code/recipes, not static PNGs**.
7. **Two chrome themes:** iron (default), brass (`[data-frame="brass"]`).

## Step 1 — Route the request to a method
Pick before drawing:
- **Code → static PNG sprite** (`spritekit`, Python/Pillow): tiles, items, **icons**, simple/symmetric creatures, props, and any **recolor / tier / rarity variant**. Grid-perfect and cheap to vary.
- **Code → in-engine procedural** (Pixi/canvas code): the loot beacon, fire VFX, burn flame, and terrain recipes — anything that must tint or animate at runtime. Output code, not a PNG.
- **AI-generator-directed:** brand-new creatures with unique/asymmetric silhouettes, bosses, detailed scenes. Emit a generation prompt (subject · native size · view/angle · token-palette reference · explicit avoid-list: blur, off-grid pixels, extra colours), then a cleanup checklist (downscale to native cell → reduce to token palette → fix to grid → slice/mirror into the 8-dir strip). The skill preps and cleans; it does not render the raw image.

State which method you chose and why in one line, then proceed.

## Step 2 — Generate with the toolkit
For code sprites, write a small generator that imports `spritekit` and follow `scripts/cinderbat.py`
as the canonical pattern: build each frame on a `Grid`, draw with the primitives, mirror symmetric
halves, apply a hard `outline`, then `save_strip` / `save_preview` / `save_gif`. Keep designs readable
at native size (silhouette first), use the `roles()` art-colours or pick tokens directly, and respect
the light source (default top-left).

`spritekit` gives you: `load_palette()` / `roles()`, a `Grid` with `disc / line / poly / mirror_x / outline`,
`rot()`, `save_strip / save_preview / save_gif`, `recolor()` for variant batches, and
`manifest_entry()` + `upsert_manifest()`.

## Step 3 — Always validate visually
Open the generated `*_preview.png` and check: does the silhouette read at native size? On-grid, no
stray AA pixels? Only token colours? Correct size/anchor for its type? Iterate the generator until it's
right — never ship the first pass unseen.

## Step 4 — Wire it in
- Save the native transparent strip into the assets folder using the naming convention:
  prefix (`env_ npc_ mob_ hero_ boss_ item_ icon_ fx_ ui_`), snake_case, with a facing/animation
  suffix (`_8dir`, `_s`, `_fly`, etc.). Example: `mob_cinderbat_fly_s.png`.
- Add the manifest entry via `upsert_manifest()` (cols, rows, cellW, cellH, frames, anchor, renderScale,
  fps for animations, and a short note).
- The `*_preview.png` / `*.gif` are for human review only — they do not ship.

## Variants in bulk ("hella assets")
To spin tiers/rarities/reskins fast, palette-swap an existing sheet the way the ghoul was made from the
skeleton: `spritekit.recolor(src, {from_hex: to_hex}, dst)`. Loop a list of colour-maps to batch a whole
family in one run, then add a manifest entry per variant.

**Example — input → output**
- "add a flying enemy" → choose Code; generator → `assets/mob_<name>_fly_s.png` (+ manifest entry, preview).
- "make 4 rarity versions of the fire sword icon" → Code + `recolor()` over the rarity colours → four `item_*` PNGs (+ entries).
- "we need a swamp boss" → AI-generator route: emit prompt + avoid-list, then the cleanup checklist to bring it on-grid and on-palette.

# The Sundered Reaches — Art Bible (skill quick-reference)

> Quick reference for generating on-style assets. The repo's `tokens.json` and `spritesheet_map.json` are authoritative if they ever differ from this.

## The game
Isometric (64×32 tile) action-RPG / loot-crawler. Stack: **Solid.js + Tailwind v4 + PixiJS**. Player is a **Pyromancer** (fire magic). Two resources: **Spirit** (cool blue) and **Wrath** (molten orange). Dark, necrotic world — skeletons, ghouls, bonecasters, a glowing "Veil-fissure." Loot has 5 rarities; there's a **Forge / Refinement** action. Fonts: **Pixelify Sans** (display/body/numbers), **Silkscreen** (small all-caps labels).

## Canonical files (source of truth — upload all of these)
- `tokens.css` / `tokens.json` — every color, font, size, spacing, bevel/glow recipe. **The palette lives here.**
- `spritesheet_map.json` — sheet manifest: cols×rows, native cell, frame order, anchors, render scale, procedural recipes.
- `hud.css` — the `.ts-*` UI component kit (orbs, slots, tooltips, forge button…).
- `README.md` — drive model, Pixi setup, iso math.
- `Handoff.html` — living styleguide (renders everything in all states).
- `assets/*.png` — existing sprites (visual reference for style + proportions).

> Don't re-transcribe these — they're authoritative. This brief just indexes them and states the rules never to break.

## Non-negotiable production rules
1. **Pixel-perfect rendering:** square corners (radius 0), `image-rendering: pixelated`, **integer scale only**, **NEAREST** filtering. UI bevels are hard-edged 2px `box-shadow`s — **no blur, ever.**
2. **Authoring resolution:** 1 texel = 1 art pixel. Transparent PNG horizontal strips at native cell size.
3. **8-direction order is always** `[e, se, s, sw, w, nw, n, ne]`. `sw / w / nw` are horizontal mirrors of `se / e / ne` (mirror at runtime is fine).
4. **Iso math:** logical tile 64×32; `screen = ((tx−ty)*32, (tx+ty)*16)`. Actor anchor is bottom-center `[0.5, ~0.95]` (the feet).
5. **Palette discipline:** use **only** token colors. **Rarity colors are globally constant — never zone-tinted.** `--void (#0d0d12)` is background only, never an asset fill.
6. **Shipped PNG vs procedural:** loot beacons, all fire VFX, burn flames, and terrain are **drawn in-engine (Pixi)** so they tint/animate — deliver these as **code/recipes, not static PNGs.**
7. **Two chrome themes:** iron (default) and brass (`[data-frame="brass"]`).

## Palette at a glance (canonical = `tokens.json`)
- **Fire ramp:** `#fff1c4` white-hot → `#ff9f1a` ember → `#b0301a` blood-coal · Burn accent `#ff6a3a`
- **Spirit (blue):** dark `#3a64a8` → light `#6ab0ff`
- **Wrath (orange):** dark `#a04a1f` → light `#ff8a3a`
- **Terrain:** grass `#2e3a30` / `#28342a`, rock `#2a1a1a`
- **Rarity (constant):** white `#e8e8e8` · blue `#6a9bff` · yellow `#ffe04a` · green `#48d06a` · gold `#ff9f1a` *(gold is top tier — it's the UI accent and its beacon gets extra fire particles)*
- **Iron frame:** edge `#080706`, band `#2b2420`, inner `#13100d`, bevel-hi `#5a4d36`
- **Brass frame:** edge `#1a120a`, band `#6e5328`, inner `#241810`, bevel-hi `#a9842f`
- **Text:** base `#d8cdbb`, dim `#8a7f6e`, bright `#f0deba`, on-accent `#1a120a`
- **Backdrop:** void `#0d0d12`, ink `#08080b`

## Sprite sizing (native cell → ×scale → display)
| Type | Native | Scale | Display | Anchor |
|---|---|---|---|---|
| Hero | 16×21 | 2× | 32×42 | 0.5, 0.95 |
| Mob | 16×19 | 2× | 32×38 | 0.5, 0.95 |
| Caster | 16×21 | 2× | 32×42 | 0.5, 0.95 |
| Icon | 16×16 | 2× | 32×32 | 0.5, 0.5 |
| Loot | 16×16 | 1× | 16×16 | 0.5, 0.9 |
| Wisp | 7×8 | 3× | 21×24 | 0.5, 0.6 |

## Existing assets (build new ones as consistent siblings)
- **hero_pyromancer_idle_8dir** — 8×(16×21). Orb hidden on n/ne/nw facings.
- **mob_skeleton_base** — 8×(16×19). *Brute* = same sheet at 2.5× + `ui_brute_shield` overlay on the screen-near side. *Burning* = + procedural flame overlay.
- **mob_ghoul** — 8×(16×19). Skeleton silhouette **re-skinned to rotting-green** (the model-recolor pattern).
- **mob_bonecaster_8dir** — 8×(16×21). Ranged skull-mage; necrotic orb hidden on n/ne/nw.
- **fx_veilwisp** — 2×(7×8) bob loop; floats ~22px above the tile.
- **icon_skills** — 6×(16×16): spark, cinder, fireball, pyroclasm, combust, meteor.
- **ui_brute_shield** — 1×(5×6) iron shield overlay.
- **Procedural (no PNG):** loot beacon (per-rarity diamond + light beam + ground ring; gold adds 3 orbiting fire particles); fire FX (stepped fire-blob discs core→ember→coal); burn flame (2-frame 5×5); terrain (64×32 iso diamonds, grass checker + rock + glowing fissure seam, posterized + vignette).

## How the blend routes for THIS game
- **Code → static PNG sprites** (Python/Pillow): new mob variants via palette-swap of an existing sheet (exactly how the ghoul was made), new 16×16 skill/item icons matching `icon_skills`, rarity/tier recolors.
- **Code → in-engine procedural** (JS / Pixi Graphics): the loot beacon, fire VFX, burn flame, and terrain recipes — anything that must tint or animate at runtime.
- **AI-generator-directed:** brand-new creatures and bosses not derivable from the skeleton base, detailed environment props, concept passes. Then: downscale to native cell → reduce to token palette → fix to grid → slice/mirror into the 8-dir strip.
- **Both + cleanup:** hero-tier and boss assets — AI base, then hand-clean in Aseprite to native cell + token palette, then build the 8-dir strip.

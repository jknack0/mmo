# MMO — Pixel Art Bible (16-bit) & Prompt Pack

Single source of truth for the visual style + a paste-ready prompt pack. Style is
**16-bit SNES-era pixel art**, isometric 2:1. Hand-placed pixels, limited palette,
hard edges, selective dithering. Think *Secret of Mana / Chrono Trigger* sprite
craft meets *Diablo II* grim-dark mood, on a true iso grid.

> **Pipeline:** BLEND. Code-gen the math stuff (iso tiles, glows, rarity beacons,
> resource orbs, FX particles) pixel-native; AI-gen the organic stuff (hero, mobs,
> icons, boss) with a pixel model (Retro Diffusion / PixelLab / Scenario pixel
> LoRA), then a human/Claude cleanup pass for grid + palette. Lock ONE master
> palette + sizes across the whole set or it falls apart.

---

## 0. The world in one breath

Dark-fantasy iso ARPG. Thirty years ago **the Sundering** shattered the southern
continent + tore holes in **the Veil**. Survivors hold **Hold Veridian**; they
raid the corrupted **Sundered Reaches** to kill, loot, tap gear. Alpha hero =
**Pyromancer**, a robed INT caster slinging Fire + stacking Burn. Mood: grim,
ember-lit, ominous. Craft: clean 16-bit, readable at 1× zoom.

## 1. Pixel rules — NON-NEGOTIABLE

- **No anti-aliasing on outer edges.** Hard pixel edges. Selective AA only
  *inside* a sprite for soft gradients (skin, robe folds) — never on the
  silhouette.
- **Dark selective outline (selout):** 1px outline, darkest value of the local
  hue (not pure black) on lit sides, pure-ish black on shadow sides. No outline
  where the sprite meets its own cast shadow.
- **Limited palette per sprite:** 8–16 colors, pulled from the master ramp set.
  No gradient banding > what a 4–5 step ramp gives you.
- **Dithering = texture, not gradient fill.** Checker/ordered dither only for
  material texture (stone, smoke, ember haze). Sparse. Never a lazy 2-color fade.
- **One light:** key from **upper-left**, 1–2 step shadow ramp to lower-right.
  Every asset shares it.
- **Pixel-perfect iso:** 2:1 dimetric. Tile edges step **2px across, 1px down**
  (the clean iso line). Snap art to the 64×32 diamond.
- **Integer scale only at runtime** (nearest-neighbor). Never render at 1.5×.

## 2. Camera & sizes (match the renderer)

- Iso diamond tile: **64 × 32 px** (`ISO_TILE_W=64`, `ISO_TILE_H=32`),
  `screen = ((tx-ty)*32, (tx+ty)*16)`. Background `#0d0d12`.
- Base sprite sizes (the art canvas; height can exceed the tile):
  - **Hero (Pyromancer):** 32×48, feet-anchored bottom-center.
  - **Mob (skeleton):** 32×40.
  - **Mini-boss:** 64×80.
  - **Ground loot:** 16×16 + a 1–2px rarity glow.
  - **Item icon:** 32×32 (inventory).
  - **Tile:** 64×32 diamond top face.
- Anchors: characters/mobs = bottom-center feet; tiles = diamond center; loot =
  base of the item.

## 3. Master palette (ramps)

Background `#0d0d12` (canvas only, never an asset color).

**Terrain — Sundered Reaches (5-step ash-green ramp):**
`#1c241d → #28342a → #2e3a30 → #3c4a3a → #506247`
Blocked rock (charred): `#1a1212 → #2a1a1a → #3a2622`

**Fire / Pyromancy (the signature 5-step):**
`#b0301a → #e0531f → #ff9f1a → #ffd24a → #fff1c4`  (coal → ember → white-hot)
Burn DoT accent: `#ff6a3a`. Soot/smoke: `#2a2228 → #4a4048 → #6a6068`.

**Bone / skeleton (4-step):** `#3a3428 → #6a6048 → #a89a72 → #d8caa0`,
necrotic eye glow `#5ad0ff`.

**Leather / metal (hero + items):** leather `#3a2a1e → #6a4a30 → #9a7048`,
iron `#2a2e36 → #4a525e → #7a8694`, copper `#5a3a1e → #9a6a32 → #d2a050`.

**Resources:** Spirit `#3a64a8 → #6ab0ff`. Wrath `#a04a1f → #ff8a3a`.

**Rarity glow — GLOBALLY CONSTANT, never zone-tinted:**
white `#e8e8e8` · blue `#6a9bff` · yellow `#ffe04a` · green `#48d06a` · gold `#ff9f1a`.

---

## MASTER PREAMBLE  *(prepend to every AI prompt)*

```
16-bit SNES-era pixel art, isometric 2:1 dimetric, dark-fantasy ARPG ("the
Sundering"). Hand-placed pixels, NO anti-aliasing on outer edges, hard pixel
edges, 1px dark selective outline. Limited 8–16 color palette pulled from a
muted ash-green + grim-leather set, EXCEPT fire which uses a vivid 5-step ramp
(coal #b0301a → ember #ff9f1a → white-hot #fff1c4). Selective dithering for
material texture only. Single key light upper-left, short shadow ramp
lower-right. Clean readable silhouette at small size. Crisp, no blur, no
gradients, no AA halo. Transparent background, centered, no text, no UI frame.
Style of Secret of Mana / Chrono Trigger sprite craft with Diablo II grimdark
mood. Consistent palette + scale across the whole set.
```

---

## ASSET PROMPTS  *(append one after the preamble)*

### A. Terrain tiles — Sundered Reaches (64×32 diamonds, seamless)
```
…a single seamless isometric 2:1 diamond ground tile, top face only, 64×32.
Cracked ashen earth, sparse sickly moss (ash-green ramp #28342a→#506247), faint
ember cracks glowing dull orange in the soil. Pixel-perfect iso edges (2px
across, 1px down). Variants: (1) plain ground, (2) charred raised rock outcrop
#2a1a1a impassable, (3) glowing Veil-fissure seam. Transparent bg.
```

### B. Pyromancer hero (32×48, feet-anchored, 8-dir + anims)
```
…a 32×48 pixel-art Pyromancer mage, iso 3/4 view, hooded charcoal-ash robe with
ember-orange frayed trim, leather pauldron, a smoldering focus orb in hand,
inner fire glow leaking from sleeves + hood, drifting ember pixels. Grim,
weathered. Output: 8-direction idle (1–2 frame breathe), a 4-frame walk cycle,
and a 4-frame cast pose (arm raised, fire bloom). Pixel-perfect, transparent bg,
consistent palette.
```

### C. Skeleton mob (32×40) + variants — replaces grey rectangle
```
…a 32×40 pixel-art reanimated skeleton warrior, iso 3/4, yellowed charred bone
(ramp #6a6048→#d8caa0), rusted scrap-iron helm + cleaver, cold blue necrotic
eye-glow #5ad0ff, ash flaking off. Variants: (1) plain, (2) BURNING (Burn-stack
flames #ff6a3a licking the bones), (3) shielded "brute". Include a 4-frame
collapse-to-ash death. Menacing silhouette, transparent bg.
```

### D. Ground loot beacons (16×16 + rarity glow) — replaces gem diamonds
```
…a 16×16 pixel-art dropped loot item on the ground, with a 1–2px vertical glow
beam + ground ring in its rarity color, readable from across the screen. SAME
silhouette in 5 rarity tints, glow scaling up: white #e8e8e8 faint, blue #6a9bff
soft, yellow #ffe04a bright, green #48d06a bright, gold #ff9f1a radiant with
2–3 orbiting ember pixels. Output as a 5-frame strip, transparent bg.
```

### E. Pyromancy skill FX (pixel anim strips, top of the iso plane)
```
…pixel-art Fire spell FX, iso, vivid 5-step fire ramp (#b0301a→#ff9f1a→#fff1c4),
soot smoke dither, ember sparks. Each as a 6-frame strip, transparent bg:
1) SPARK — fast pinpoint bolt + tiny impact puff.
2) CINDER SPRAY — short ember fan / scorch cone.
3) FIREBALL — tumbling orb + radial burst.
4) PYROCLASM — towering white-hot column (elite, tall).
5) COMBUST — Burn stacks detonating, fire rings off the enemy.
6) METEOR — falling flaming rock + telegraph ring + impact.
7) BURN — small 2-frame looping flame badge on a burning enemy.
```

### F. Item icons (32×32, inventory)
```
…a 32×32 pixel-art dark-fantasy ARPG inventory item icon, centered, 1px dark
outline, grim materiality, tiny inner glow. Set: Rusty Sword, Apprentice Wand
(ember tip), Wooden Buckler, Apprentice Orb (glowing), Leather Cap/Vest/Greaves/
Boots/Gloves, Copper Ring, Copper Amulet, + uniques "Cinderheart" (smoldering
amulet, living-coal core) and "Emberfang" (fire-veined blade). Uniques get a
gold #ff9f1a 1px aura. Transparent bg.
```

### G. HUD / UI kit (pixel chrome)
```
…a 16-bit pixel-art dark-fantasy UI kit: charred-iron + ember-brass frames,
1px highlights. Produce: a 6-slot hotbar frame, two resource orbs (Spirit blue
#6ab0ff, Wrath orange #ff8a3a) with pixel fill levels, a circular skill button
with a cooldown sweep, a rarity-bordered item slot (swappable border color),
a tooltip panel bg, a tap/Refinement "forge" button. 9-slice friendly edges,
transparent bg.
```

### H. Hold Veridian (safe-town set — future)
```
…16-bit iso pixel tiles + props for a fortified survivor city post-Sundering:
warm lantern-lit cobblestone diamonds, charred timber + stone buildings, a
vendor stall, a trainer's brazier, banners. Warmer amber palette than the
Reaches. Same 64×32 grid, seamless, transparent bg.
```

### I. Rift mini-boss (64×80 — future)
```
…a 64×80 pixel-art Veil-touched fire-demon mini-boss, iso 3/4, charred obsidian
hide cracked with molten lava veins #ff9f1a, horns, glowing Veil-rift scars.
Telegraph-friendly silhouette. Idle (2-frame) + a 6-frame slam attack.
Transparent bg.
```

---

## 4. Runtime integration (PixiJS — keep pixels crisp)

- Set nearest-neighbor + pixel snapping globally:
  ```ts
  import { TextureSource } from 'pixi.js';
  TextureSource.defaultOptions.scaleMode = 'nearest';
  // app.init({ ..., roundPixels: true });  // and per-sprite sprite.roundPixels = true
  ```
- **Integer zoom only** (1×, 2×, 3×). Never 1.5×.
- Sprite sheets: horizontal frame strips, fixed cell size, power-of-two sheet;
  document `cols × rows × cellW × cellH`.
- Files → `apps/client/public/assets/…`; swap placeholder `Graphics` for
  `Sprite.from(texture)` (load via `Assets.load`). Keep rarity-tint logic on the
  loot beam.
- **Naming:** `terrain_reaches_{plain,rock,fissure}.png`,
  `hero_pyromancer_{idle8,walk,cast}.png`,
  `mob_skeleton_{base,burning,brute,death}.png`, `loot_beacon_strip.png`,
  `fx_{spark,cinder,fireball,pyroclasm,combust,meteor,burn}.png`,
  `icon_{baseId}.png`, `ui_{hotbar,orb_spirit,orb_wrath,skillbtn,slot,tooltip,forge}.png`.

## 5. Reject-an-asset checklist

- [ ] NO outer-edge anti-aliasing / no blur halo
- [ ] 1px dark selout, light upper-left, shadow lower-right
- [ ] palette pulled from the master ramps (≤16 colors/sprite)
- [ ] fire uses the 5-step coal→white-hot ramp; rarity colors exact + untinted
- [ ] pixel-perfect 2:1 iso edges; snaps to 64×32
- [ ] transparent bg, correct anchor, integer-scalable

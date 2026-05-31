# sundered-sprites — repo wiring

How this skill is plugged into the mmo repo. (The generic skill steps live in
`SKILL.md`; this file is the concrete path/run setup for THIS project.)

## Paths in this repo
| Thing | Path |
|---|---|
| Assets dir (ship here) | `apps/client/public/assets/` |
| Sheet manifest | `apps/client/public/assets/spritesheet_map.json` |
| Palette (authoritative) | `apps/client/public/assets/tokens.json` |
| Toolkit | `.claude/skills/sundered-sprites/scripts/spritekit.py` |
| Worked example | `.claude/skills/sundered-sprites/scripts/cinderbat.py` |
| Python venv (Pillow) | `.claude/skills/sundered-sprites/.venv/` (gitignored) |

`tokens.json` mirrors `apps/client/src/styles/tokens.css` and is the source
`spritekit.load_palette()` reads, so generated art can't drift. Keep them in
sync if the CSS palette changes.

## One-time setup
```bash
python3 -m venv .claude/skills/sundered-sprites/.venv
.claude/skills/sundered-sprites/.venv/bin/pip install pillow
```

## Generate an asset
```bash
# preview/strip/gif → a scratch dir (preview + gif are review-only, never ship)
.claude/skills/sundered-sprites/run.sh scripts/cinderbat.py /tmp/art

# ship the strip + register it
cp /tmp/art/mob_cinderbat_fly_s.png apps/client/public/assets/
.claude/skills/sundered-sprites/.venv/bin/python - <<'PY'
import sys; sys.path.insert(0, ".claude/skills/sundered-sprites/scripts")
import spritekit as sk
sk.upsert_manifest(
  "apps/client/public/assets/spritesheet_map.json",
  "mob_cinderbat_fly_s.png",
  sk.manifest_entry(cols=4, cellW=16, cellH=16,
    frames=["fly_a","fly_b","fly_c","fly_d"], anchor=[0.5,0.95],
    render_scale=2, fps=9, note="…"),
)
PY
```
`run.sh` runs from `apps/client/` so spritekit auto-finds `public/assets/tokens.json`.

## Light it up in the game
The client asset registry (`apps/client/src/world/asset-registry.ts`) loads
**every** sheet in the manifest automatically — a new sheet shows up with no
code change. To make a new **mob kind** render in-world, add a `kind → sheet`
row to `MOB_SHEETS` in `apps/client/src/world/asset-manifest.ts` (the server
mob `kind` string). Example already wired: `cinderbat`.

> Only the transparent strip PNG ships. `*_preview.png` / `*.gif` are for human
> review — keep them out of `public/assets/`.

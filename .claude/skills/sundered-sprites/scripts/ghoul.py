#!/usr/bin/env python3
"""Ghoul - the skeleton re-skinned to a rotting-green palette. Demonstrates the
recolor pattern over an *animated* clip sheet: a palette swap of
mob_skeleton_base.png carries every idle/move frame across for free, so the
ghoul animates identically without re-authoring any pixels.

Depends on skeleton.py having written mob_skeleton_base.png into the same dir.
Run:  python scripts/skeleton.py OUT && python scripts/ghoul.py OUT
"""
import sys, os
import spritekit as sk
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
SRC = os.path.join(OUT, "mob_skeleton_base.png")

# Bone tokens -> the established ghoul greens (sampled from the shipped ghoul).
# Ember eyes (#ff9f1a) are left untouched so the glow still reads.
GHOUL = {
    "#d8cdbb": "#6f9054",   # BONE      -> rot green
    "#f0deba": "#9fb87e",   # BONE_HI   -> pale green highlight
    "#8a7f6e": "#436035",   # BONE_SH   -> deep green shadow
    "#08080b": "#0e140d",   # OUTLINE   -> green-black ink
}

dst = os.path.join(OUT, "mob_ghoul.png")
sk.recolor(SRC, GHOUL, dst)
sk.save_preview(Image.open(dst).convert("RGBA"),
                os.path.join(OUT, "ghoul_sheet_preview.png"), scale=8)
print("ghoul: recolored mob_skeleton_base.png -> mob_ghoul.png (+ preview)")

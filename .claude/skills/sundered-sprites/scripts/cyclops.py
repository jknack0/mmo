#!/usr/bin/env python3
"""Cyclops - one-eyed stone giant, boss-scale, front (s) facing, 2-frame idle breathe.
Symmetric hulk built on the spritekit grid: planted legs, broad hunched torso,
small fused head with one big ember eye, heavy fists, bone club in the right fist.
Native 24x28 (bigger than the 16x19 trash mobs so it reads as a boss).
Run:  python scripts/cyclops.py [out_dir]
"""
import sys, os
import spritekit as sk

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(OUT, exist_ok=True)
W, H = 24, 28
CX = 11.5
pal = sk.load_palette()
g_ = lambda k: sk.rgba(pal[k])

SKIN     = g_("text.dim")      # #8a7f6e stone flesh
SKIN_SH  = g_("frame.band")    # #2b2420 shadow
SKIN_DK  = g_("frame.inner")   # #13100d deep shadow / brow
SKIN_HI  = g_("text.base")     # #d8cdbb top-left lit
WRAP     = g_("terrain.rock")  # #2a1a1a loincloth
WRAP_HI  = g_("frame.band")
CLUB     = g_("text.base")     # bone club
CLUB_SH  = g_("text.dim")
EYE_RIM  = g_("fire.coal")     # #b0301a
EYE_IRIS = g_("fire.mid")      # #ff9f1a
EYE_CORE = g_("fire.core")     # #fff1c4
TEETH    = g_("text.bright")   # #f0deba
OUTLINE  = g_("ink")           # #08080b


def block(g, x0, y0, x1, y1, c):
    for x in range(int(x0), int(x1) + 1):
        for y in range(int(y0), int(y1) + 1):
            g.put(x, y, c)


def frame(bob=0, eye=0):
    g = sk.Grid(W, H)
    b = bob  # upper body lifts by `bob` on the breathe-in frame; legs stay planted.

    # ── Legs + feet (planted, never bob) ───────────────────────────
    block(g, 6, 21, 9, 26, SKIN)          # left leg
    block(g, 14, 21, 17, 26, SKIN)        # right leg
    block(g, 5, 25, 10, 26, SKIN_SH)      # left foot
    block(g, 13, 25, 18, 26, SKIN_SH)     # right foot
    block(g, 9, 21, 9, 25, SKIN_SH)       # inner-leg shade
    block(g, 14, 21, 14, 25, SKIN_SH)

    # ── Hips / loincloth ───────────────────────────────────────────
    g.poly([(5, 18 - b), (18, 18 - b), (17, 23 - b), (6, 23 - b)], WRAP, edge_lo=g_("ink"))
    block(g, 11, 19 - b, 12, 23 - b, SKIN_DK)   # cloth fold

    # ── Torso (broad, hunched) ─────────────────────────────────────
    g.poly([(3, 11 - b), (20, 11 - b), (18, 20 - b), (5, 20 - b)], SKIN, edge_lo=SKIN_SH)
    block(g, 4, 9 - b, 19, 12 - b, SKIN)        # shoulder slab
    g.disc(5.5, 10 - b, 3.2, SKIN)              # left shoulder lump
    g.disc(17.5, 10 - b, 3.2, SKIN)             # right shoulder lump
    # belly / pec shading (lower-right lit from top-left)
    block(g, 12, 13 - b, 18, 19 - b, SKIN_SH)
    block(g, 11, 13 - b, 11, 19 - b, SKIN_DK)
    # top-left highlights
    for p in [(5, 9 - b), (6, 9 - b), (5, 10 - b), (4, 11 - b), (7, 12 - b)]:
        g.put(p[0], p[1], SKIN_HI)
    g.disc(5.5, 9 - b, 1.6, SKIN_HI)

    # ── Head (a single eye dominates the face) ─────────────────────
    g.disc(CX, 6 - b, 3.8, SKIN, sq=1.0)
    block(g, 9, 8 - b, 14, 10 - b, SKIN)        # heavy jaw
    block(g, 8, 3 - b, 15, 3 - b, SKIN_DK)      # thin brow ridge (kept above the eye)
    g.put(8, 4 - b, SKIN_HI); g.put(9, 3 - b, SKIN_HI)   # lit brow corner
    for x in (10, 12, 13):                      # teeth
        g.put(x, 10 - b, TEETH)
    g.put(11, 10 - b, SKIN_DK)

    # ── The Eye (single, huge, central, glowing) ───────────────────
    g.disc(CX, 6 - b, 3.1, EYE_RIM, sq=1.0)
    g.disc(CX, 6 - b, 2.3, EYE_IRIS, sq=1.0)
    g.disc(CX, 6 - b, 1.2, EYE_CORE, sq=1.0)
    g.put(10, 5 - b, EYE_CORE)                  # top-left glint
    if eye:
        g.put(13, 5 - b, EYE_CORE)              # breathe: a second spark, same size

    # ── Arms + fists ───────────────────────────────────────────────
    block(g, 1, 11 - b, 4, 19 - b, SKIN)        # left arm
    block(g, 19, 11 - b, 22, 19 - b, SKIN)      # right arm
    block(g, 1, 11 - b, 1, 19 - b, SKIN_HI)     # left arm lit edge
    block(g, 22, 12 - b, 22, 19 - b, SKIN_SH)   # right arm shade
    g.disc(2.5, 20 - b, 2.6, SKIN)              # left fist
    g.disc(21.5, 20 - b, 2.6, SKIN)             # right fist
    g.disc(2.0, 19 - b, 1.0, SKIN_HI)
    block(g, 1, 21 - b, 4, 21 - b, SKIN_SH)     # knuckle shade
    block(g, 19, 21 - b, 22, 21 - b, SKIN_SH)

    # ── Bone club (gripped in the right fist, raised over the shoulder) ──
    # Diagonal shaft from the fist (20,20) out to a fat knobbed head (top-right),
    # so it reads as a held weapon, not a standing stone.
    g.line(20, 20 - b, 23, 5 - b, CLUB, 0.0, 1.0)
    g.line(21, 20 - b, 23, 6 - b, CLUB, 0.0, 1.0)
    g.line(19, 20 - b, 22, 6 - b, CLUB_SH, 0.0, 1.0)   # shaft shade (right edge)
    g.disc(22.6, 4.5 - b, 2.4, CLUB)                   # knob head
    g.disc(23.2, 5.2 - b, 1.2, CLUB_SH)                # head shade
    g.put(21, 4 - b, SKIN_HI)                          # head glint
    block(g, 20, 19 - b, 21, 21 - b, SKIN_DK)          # grip (hand wraps shaft)

    g.outline(OUTLINE)
    return g.image()


frames = [frame(bob=0, eye=0), frame(bob=1, eye=1)]   # exhale / inhale + eye pulse
strip = sk.save_strip(frames, os.path.join(OUT, "boss_cyclops_s.png"))
sk.save_preview(strip, os.path.join(OUT, "cyclops_preview.png"))
sk.save_gif(frames, os.path.join(OUT, "cyclops_idle.gif"))
print("cyclops: wrote boss_cyclops_s.png (+ preview, gif)")

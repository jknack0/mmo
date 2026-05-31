#!/usr/bin/env python3
"""Hero - the player Pyromancer. Animated clip sheet: idle (2f) + move (4f)
across all 8 facings. A hooded robe-figure with a floating fire orb (hidden on
the back facings n/ne/nw, per the manifest note). Code route, parametric rig:
robe hem sways + body bob drive the walk; the orb bobs with it.

Run:  python scripts/hero.py [out_dir]
"""
import sys, os, math
import spritekit as sk

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(OUT, exist_ok=True)
W, H = 16, 21
pal = sk.load_palette()
R = sk.roles(pal)

ROBE   = R["MEMBRANE"]      # dark robe body (terrain.rock)
ROBE_SH= R["MEMBRANE_SH"]   # robe shadow (frame.inner)
ROBE_HI= sk.rgba(pal["wrath.0"])   # warm lit robe edge
TRIM   = R["EMBER"]         # ember trim
HOOD   = R["MEMBRANE_SH"]   # hood (deep shadow)
EYE    = R["EMBER_HOT"]     # ember-white eyes
ORB_C  = R["EMBER_HOT"]; ORB_M = R["EMBER"]; ORB_E = R["COAL"]
INK    = R["OUTLINE"]

CX = 8
HEAD_Y = 5
HEM_Y = 19


def hood(g, view, oy):
    cy = HEAD_Y + oy
    g.disc(CX, cy, 2.8, HOOD, sq=1.1)              # hood dome
    g.put(CX, cy - 3, HOOD); g.put(CX, cy - 4, ROBE_SH)   # peak
    g.put(CX - 1, cy - 2, ROBE_HI)                 # lit upper-left
    if view == "n":                                 # back of hood: no face
        for y in (cy - 1, cy, cy + 1):
            g.put(CX, y, ROBE_SH)
        return
    # shadowed face opening + ember eyes
    for x in range(CX - 1, CX + 2):
        g.put(x, cy + 1, INK)
    eyes = {"s": [(CX - 1, 0), (CX + 1, 0)], "se": [(CX, 0), (CX + 2, 0)],
            "e": [(CX + 1, 0)], "ne": [(CX + 2, 0)]}[view]
    for ex, ey in eyes:
        g.put(ex, cy + 1 + ey, EYE)


def robe(g, view, oy, sway):
    top = 7 + oy
    for y in range(top, HEM_Y + oy + 1):
        half = 1 + (y - top) * 0.42                 # widen toward the hem
        h = int(round(half))
        hx = int(round(sway)) if y >= HEM_Y + oy - 1 else 0   # hem sways
        for x in range(CX - h + hx, CX + h + 1 + hx):
            g.put(x, y, ROBE)
        g.put(CX - h + hx, y, ROBE_HI)              # lit left edge
        g.put(CX + h + hx, y, ROBE_SH)              # shadow right edge
    if view != "n":                                  # ember trim down the front
        for y in range(top + 1, HEM_Y + oy, 2):
            g.put(CX, y, TRIM)
    g.put(CX - 2, top, ROBE_SH); g.put(CX + 2, top, ROBE_SH)  # shoulders


def feet(g, oy, stride):
    s = int(round(stride))
    y = HEM_Y + oy + 1
    g.put(CX - 1 - max(0, s), y, INK)               # peeking feet, alternate
    g.put(CX + 1 + max(0, -s), y, INK)


def orb(g, view, oy, bob, show):
    if not show:
        return
    # floating fire orb at the forward hand (screen-right for these views)
    ox = {"s": CX + 4, "se": CX + 5, "e": CX + 5}[view]
    oy2 = 11 + oy + int(round(bob))
    g.disc(ox, oy2, 1.7, ORB_E)
    g.disc(ox, oy2, 1.1, ORB_M)
    g.put(ox, oy2, ORB_C)
    g.line(CX + 1, 9 + oy, ox, oy2, ROBE)           # sleeve/arm to the orb


def pose(view, stride=0.0, swing=0.0, bob=0):
    show_orb = view in ("s", "se", "e")
    g = sk.Grid(W, H)
    robe(g, view, bob, stride)
    feet(g, bob, stride)
    orb(g, view, bob, swing, show_orb)
    hood(g, view, bob)
    g.outline(INK)
    return g.image()


IDLE = [dict(bob=0, swing=0.0, stride=0.0),
        dict(bob=1, swing=0.5, stride=0.0)]          # gentle breathe + orb bob
MOVE = [dict(bob=-1, swing=-0.5, stride=0.0),
        dict(bob=0,  swing=0.5,  stride=1.0),
        dict(bob=-1, swing=-0.5, stride=0.0),
        dict(bob=0,  swing=0.5,  stride=-1.0)]

AUTHOR = {"e", "se", "s", "n", "ne"}
MIRROR = {"sw": "se", "w": "e", "nw": "ne"}


def facing_frames(facing, clip):
    if facing in AUTHOR:
        return [pose(facing, **p) for p in clip]
    src = MIRROR[facing]
    return [pose(src, **p).transpose(0) for p in clip]


COLS = max(len(IDLE), len(MOVE))


def pad(frames):
    blank = sk.Grid(W, H).image()
    return frames + [blank] * (COLS - len(frames))


rows = []
for clip in (IDLE, MOVE):
    for facing in sk.DIR_FRAMES:
        rows.append(pad(facing_frames(facing, clip)))

sheet = sk.save_sheet(rows, os.path.join(OUT, "hero_pyromancer_idle_8dir.png"))
sk.save_preview(sheet, os.path.join(OUT, "hero_sheet_preview.png"), scale=8)
sk.save_gif(facing_frames("se", MOVE), os.path.join(OUT, "hero_walk_se.gif"), fps=8)
sk.save_gif(facing_frames("s", MOVE), os.path.join(OUT, "hero_walk_s.gif"), fps=8)
print(f"hero: wrote hero_pyromancer_idle_8dir.png ({sheet.size[0]}x{sheet.size[1]}) "
      f"= idle(2)+move(4) x 8 facings (+ preview, gifs)")

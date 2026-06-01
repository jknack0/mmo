#!/usr/bin/env python3
"""Cinderbat - flying undead trash mob. Promoted to front-only clip sheet:
idle(2f@3fps, hover) + move(4f@8fps, wing-flap fly) + attack(4f@12fps, dive).

Stays front-facing (single 's' frame); clip rows are single-row blocks.
The engine's clipFrameIndex uses facing=0 for single-facing clip sheets.

Run:  python scripts/cinderbat.py [out_dir]
"""
import sys, os
import spritekit as sk

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(OUT, exist_ok=True)
W = H = 16
pal = sk.load_palette()
R = sk.roles(pal)

WING = [(0.0, -1.0), (2.6, -2.0), (4.8, -2.1), (5.8, -1.3),
        (5.2, 0.4), (4.0, 2.1), (3.0, 0.8), (2.0, 2.2), (0.7, 1.1)]
SHOULDER = (8.6, 7.4)


def body(g, oy=0):
    sy = 6 + oy
    g.disc(7.5, sy, 2.5, R["BONE"], sq=1.05)          # skull
    g.disc(7.5, sy + 4.2, 1.9, R["BONE"], sq=1.15)    # torso
    for p in [(9, 4 + oy), (9, 3 + oy), (10, 3 + oy), (10, 2 + oy),
              (6, 4 + oy), (6, 3 + oy), (5, 3 + oy), (5, 2 + oy)]:
        g.put(*p, R["BONE"])                           # ears
    for p in [(6, 5 + oy), (7, 5 + oy), (6, 9 + oy), (7, 9 + oy)]:
        g.put(*p, R["BONE_HI"])
    for p in [(8, 8 + oy), (9, 7 + oy), (8, 11 + oy), (9, 11 + oy)]:
        if g.get(*p)[3]:
            g.put(*p, R["BONE_SH"])
    g.put(6, 12 + oy, R["OUTLINE"]); g.put(9, 12 + oy, R["OUTLINE"])
    g.put(7, 8 + oy, R["MEMBRANE_SH"]); g.put(8, 8 + oy, R["MEMBRANE_SH"])
    g.put(6, 6 + oy, R["EMBER"]); g.put(9, 6 + oy, R["EMBER"])


def wing(g, deg, mirror=False, oy=0):
    pts = []
    for lx, ly in WING:
        rx, ry = sk.rot(lx, ly, deg)
        x, y = SHOULDER[0] + rx, SHOULDER[1] + ry + oy
        if mirror: x = 15 - x
        pts.append((x, y))
    g.poly(pts, R["MEMBRANE"], edge_lo=R["MEMBRANE_SH"])
    g.line(*pts[2], *pts[5], R["BONE_SH"], 0.1, 0.55)
    g.line(*pts[1], *pts[7], R["BONE_SH"], 0.1, 0.55)
    for i in range(3):
        g.line(*pts[i], *pts[i + 1], R["WING_BONE"])
    g.put(round(pts[3][0]), round(pts[3][1]), R["BONE_HI"])


def frame(deg, bob=0):
    """deg: list of (theta, mirror) for each wing flap position."""
    g = sk.Grid(W, H)
    for theta, mirror in deg:
        wing(g, theta, mirror, bob)
    body(g, bob)
    g.outline(R["OUTLINE"])
    return g.image()


# ── Clip definitions ───────────────────────────────────────────────
# Idle: hover — wings at mid-span, gentle bob.
IDLE = [dict(deg=[(0, False), (0, True)], bob=0),
        dict(deg=[(4, False), (4, True)], bob=1)]
# Move: flap — full wing-beat cycle.
MOVE = [dict(deg=[(24, False), (24, True)], bob=-1),   # downstroke
        dict(deg=[(-4, False), (-4, True)], bob=0),     # mid
        dict(deg=[(-32, False), (-32, True)], bob=-1),  # upstroke
        dict(deg=[(-4, False), (-4, True)], bob=0)]     # mid
# Attack: dive — wings wide, body lunges forward (x offset via different visual).
ATTACK = [dict(deg=[(28, False), (28, True)], bob=0),    # wings spread, ready
          dict(deg=[(20, False), (20, True)], bob=-2),    # dive, wings angled back
          dict(deg=[(12, False), (12, True)], bob=-3),    # bite, wings sweep forward
          dict(deg=[(0, False), (0, True)], bob=-1)]      # recover, wings level


def clip_frames(clip_defs):
    return [frame(**p) for p in clip_defs]


COLS = max(len(IDLE), len(MOVE), len(ATTACK))

def pad(frames):
    blank = sk.Grid(W, H).image()
    return frames + [blank] * (COLS - len(frames))

rows = []
for clip in (IDLE, MOVE, ATTACK):
    rows.append(pad(clip_frames(clip)))

sheet = sk.save_sheet(rows, os.path.join(OUT, "mob_cinderbat_fly_s.png"))
sk.save_preview(sheet, os.path.join(OUT, "cinderbat_sheet_preview.png"), scale=8)
sk.save_gif(clip_frames(MOVE), os.path.join(OUT, "cinderbat_fly.gif"), fps=8)
sk.save_gif(clip_frames(ATTACK), os.path.join(OUT, "cinderbat_attack.gif"), fps=12)
print(f"cinderbat: wrote mob_cinderbat_fly_s.png ({sheet.size[0]}x{sheet.size[1]}) "
      f"= idle(2) + move(4) + attack(4) front-only clips")

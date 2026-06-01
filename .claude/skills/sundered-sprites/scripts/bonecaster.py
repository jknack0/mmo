#!/usr/bin/env python3
"""Bonecaster - ranged skull-mage. Animated clip sheet: idle(2f@3fps, cowled
breathe) + move(4f@8fps, gliding float) + attack(4f@12fps, casting pose with
necrotic orb). 8 facings, author 5 + mirror 3.

Run:  python scripts/bonecaster.py [out_dir]
"""
import sys, os
import spritekit as sk

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(OUT, exist_ok=True)
W, H = 16, 21
pal = sk.load_palette()
R = sk.roles(pal)

BONE, HI, SH, INK = R["BONE"], R["BONE_HI"], R["BONE_SH"], R["OUTLINE"]
ROBE, ROBE_SH = R["MEMBRANE"], R["MEMBRANE_SH"]
ORB = R["EMBER"]

CX = 8
SKULL_Y = 4
BODY_Y = 11
BASE_Y = 20


def cowled_skull(g, view, oy):
    cy = SKULL_Y + oy
    # Hood cowl (arches over the skull)
    for x in range(5, 12):
        g.put(x, cy - 3, ROBE_SH)
    g.put(5, cy - 2, ROBE); g.put(11, cy - 2, ROBE_SH)
    if view == "n":  # back of cowl, dark
        for y in (cy - 2, cy - 1, cy):
            g.put(CX, y, ROBE_SH)
        return
    # Skull inside cowl
    g.disc(CX, cy, 2.5, BONE, sq=1.05)
    for x in range(6, 11):
        g.put(x, cy + 2, BONE)  # jaw
    g.put(6, cy + 2, SH); g.put(10, cy + 2, SH)
    g.put(CX - 2, cy - 1, HI)
    eyes = {"s": [(6, 0), (9, 0)], "se": [(7, 0), (10, 0)], "e": [(9, 0)], "ne": [(10, 0)]}[view]
    for ex, ey in eyes:
        g.put(ex, cy + ey, ORB)
    g.put(CX, cy + 1, SH)


def robed_body(g, view, oy):
    top, bot = 8 + oy, BASE_Y + oy
    # Tapered robe column
    for y in range(top, bot):
        half = 2 if y < bot - 2 else 4  # flare at hem
        for x in range(CX - half, CX + half + 1):
            if x < 0 or x >= W: continue
            g.put(x, y, ROBE if x <= CX else ROBE_SH)
    # Spine column (visible through robe opening)
    if view != "n":
        for y in range(top, top + 4):
            g.put(CX, y, BONE)
    if view == "n":
        for y in range(top, bot):
            g.put(CX, y, ROBE_SH)


def arms_cast(g, view, oy, cast=0.0):
    """Arms: at rest (cast=0) hands rest at waist; cast>0 extends forward for spell."""
    sh_y = 8 + oy
    hand_y = sh_y + 4 - int(round(cast * 3))
    reach = int(round(cast * 4))
    if view in ("s", "n", "se", "ne"):
        lx, rx = CX - 3, CX + 3
        g.line(lx, sh_y, lx - reach, hand_y, BONE)
        g.line(rx, sh_y, rx + reach, hand_y, SH if view == "n" else BONE)
    else:  # e
        fx = CX + 2
        g.line(fx, sh_y, fx + reach, hand_y, BONE)
        g.line(CX - 1, sh_y, CX - 1, sh_y + 4, SH)
    # Necrotic orb at the near hand during cast
    if cast > 0.5:
        orb_x = (CX + 3 + reach) if view != "n" else CX
        orb_y = hand_y - 1
        g.disc(orb_x, orb_y, 2.0, ORB, sq=1.0)
        g.put(orb_x - 1, orb_y - 1, R["EMBER_HOT"])


def pose(view, bob=0, cast=0.0):
    g = sk.Grid(W, H)
    robed_body(g, view, bob)
    arms_cast(g, view, bob, cast)
    cowled_skull(g, view, bob)
    g.outline(INK)
    return g.image()


IDLE = [dict(bob=0, cast=0.0), dict(bob=1, cast=0.0)]
MOVE = [dict(bob=-1, cast=0.0), dict(bob=0, cast=0.0),
        dict(bob=-1, cast=0.0), dict(bob=0, cast=0.0)]
ATTACK = [dict(bob=-1, cast=0.0),    # wind-up (arms pull back)
          dict(bob=-2, cast=0.8),     # cast forward
          dict(bob=-1, cast=1.0),     # orb out
          dict(bob=0, cast=0.3)]      # recover

AUTHOR = {"e": "e", "se": "se", "s": "s", "n": "n", "ne": "ne"}
MIRROR = {"sw": "se", "w": "e", "nw": "ne"}

def facing_frames(facing, clip):
    if facing in AUTHOR:
        return [pose(AUTHOR[facing], **p) for p in clip]
    src = MIRROR[facing]
    return [pose(src, **p).transpose(0) for p in clip]

COLS = max(len(IDLE), len(MOVE), len(ATTACK))

def pad(frames):
    blank = sk.Grid(W, H).image()
    return frames + [blank] * (COLS - len(frames))

rows = []
for clip in (IDLE, MOVE, ATTACK):
    for facing in sk.DIR_FRAMES:
        rows.append(pad(facing_frames(facing, clip)))

sheet = sk.save_sheet(rows, os.path.join(OUT, "mob_bonecaster_8dir.png"))
sk.save_preview(sheet, os.path.join(OUT, "bonecaster_sheet_preview.png"), scale=8)
sk.save_gif(facing_frames("s", ATTACK), os.path.join(OUT, "bonecaster_attack_s.gif"), fps=12)
print(f"bonecaster: wrote mob_bonecaster_8dir.png ({sheet.size[0]}x{sheet.size[1]}) "
      f"= idle(2) + move(4) + attack(4) x 8 facings")

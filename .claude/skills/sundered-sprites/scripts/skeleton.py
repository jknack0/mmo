#!/usr/bin/env python3
"""Skeleton - basic undead trash mob. The canonical *animated* actor: a
multi-row clip sheet with idle (2f) + move (4f) across all 8 facings.

Worked example of the clip pattern (S-anim): author 5 distinct views
(e, se, s, n, ne); mirror se/e/ne -> sw/w/nw. Each view is composed from
parametric parts (skull / ribcage / arms / legs) driven by a walk `stride`
and `swing`, plus a vertical `bob`, so the 6 frames per facing fall out of
one pose() call. Export a 2D sheet (rows = idle|move x 8 facings, cols =
frames) + a preview + per-facing gifs.

Run:  python scripts/skeleton.py [out_dir]
"""
import sys, os
import spritekit as sk

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(OUT, exist_ok=True)
W, H = 16, 19
pal = sk.load_palette()
R = sk.roles(pal)

BONE, HI, SH, INK = R["BONE"], R["BONE_HI"], R["BONE_SH"], R["OUTLINE"]
EYE = R["EMBER"]

CX = 8           # body centre column
SKULL_Y = 4      # skull centre row (before bob)
HIP_Y = 12       # pelvis row
FOOT_Y = 18      # ground row


def skull(g, view, oy):
    """Cranium + jaw. Eyes/suture depend on which way the skull turns."""
    cy = SKULL_Y + oy
    g.disc(CX, cy, 2.7, BONE, sq=1.05)         # cranium
    for x in range(6, 11):                      # jaw band
        g.put(x, cy + 2, BONE)
    g.put(6, cy + 2, SH); g.put(10, cy + 2, SH)  # jaw corners shadowed
    g.put(CX - 2, cy - 1, HI); g.put(CX - 1, cy - 2, HI)  # top-left lit
    if view == "n":                             # back of head: suture, no eyes
        for y in (cy - 1, cy, cy + 1):
            g.put(CX, y, SH)
        return
    eyes = {"s": [(6, 0), (9, 0)], "se": [(7, 0), (10, 0)],
            "e": [(9, 0)], "ne": [(10, 0)]}[view]
    for ex, ey in eyes:
        g.put(ex, cy + ey, EYE)
    g.put(CX, cy + 1, SH)                        # nasal shadow


def ribcage(g, view, oy):
    """Spine column + rib ticks (front/3-4) or a lit spine ridge (back)."""
    top, bot = 7 + oy, HIP_Y + oy
    for y in range(top, bot):
        g.put(CX, y, BONE)
    if view == "n":                             # back: bright spine ridge
        for y in range(top, bot):
            g.put(CX, y, HI)
        g.put(CX + 1, top, SH)
        return
    # ribs: pairs stepping inward, shadowed on the screen-right side
    for i, y in enumerate(range(top + 1, bot, 1)):
        reach = 3 - (i % 2)                     # alternate long/short ribs
        if view in ("s", "se"):
            g.put(CX - reach, y, BONE); g.put(CX - reach + 1, y, BONE)
        g.put(CX + reach - 1, y, SH); g.put(CX + (reach - 2 if reach > 1 else 0), y, BONE)


def arms(g, view, oy, swing):
    """Two arms (front/back) or one forward + one shadowed (side)."""
    sh_y = 7 + oy
    near_h = sh_y + 4 + max(0, int(round(swing)))   # near hand swings down
    far_h = sh_y + 4 - max(0, int(round(swing)))
    if view in ("s", "n", "se", "ne"):
        lx, rx = CX - 3, CX + 3
        g.line(lx, sh_y, lx, far_h, BONE)
        g.line(rx, sh_y, rx, near_h, SH if view in ("n",) else BONE)
        g.put(lx, far_h, HI); g.put(rx, near_h, SH)
    else:  # e: front arm (screen-right) swings, back arm hinted
        fx = CX + 2
        g.line(fx, sh_y, fx, near_h, BONE); g.put(fx, near_h, HI)
        g.line(CX - 1, sh_y, CX - 1, sh_y + 4, SH)


def legs(g, view, oy, stride):
    """Pelvis + two legs. stride in [-1,1] strides the legs fore/aft (side) or
    splays them (front/back). The lifted leg's foot rises a pixel."""
    hip = HIP_Y + oy
    for x in range(CX - 2, CX + 3):             # pelvis block
        g.put(x, hip, BONE)
    g.put(CX + 2, hip, SH)
    s = int(round(stride))
    if view in ("e", "ne"):                     # profile stride: feet move in x
        front_x, back_x = CX + 1 + s, CX - 1 - s
        fl = FOOT_Y - (1 if s > 0 else 0)
        bl = FOOT_Y - (1 if s < 0 else 0)
        g.line(CX, hip, front_x, fl, BONE); g.put(front_x, fl, INK)
        g.line(CX, hip, back_x, bl, SH); g.put(back_x, bl, SH)
    else:                                       # front/back: legs splay L/R
        lx, rx = CX - 1, CX + 1
        ll = FOOT_Y - (1 if s > 0 else 0)
        rl = FOOT_Y - (1 if s < 0 else 0)
        g.line(lx, hip, lx - abs(s), ll, BONE); g.put(lx - abs(s), ll, INK)
        g.line(rx, hip, rx + abs(s), rl, BONE); g.put(rx + abs(s), rl, INK)


def pose(view, stride=0.0, swing=0.0, bob=0):
    g = sk.Grid(W, H)
    legs(g, view, bob, stride)
    ribcage(g, view, bob)
    arms(g, view, bob, swing)
    skull(g, view, bob)
    g.outline(INK)
    return g.image()


# ── Clip definitions ───────────────────────────────────────────────
# idle: 2-frame breathe (settle 1px). move: 4-frame walk (stride + bounce).
IDLE = [dict(bob=0, swing=0.0, stride=0.0),
        dict(bob=1, swing=0.0, stride=0.0)]
MOVE = [dict(bob=-1, swing=0.0, stride=0.0),   # passing (up)
        dict(bob=0,  swing=1.0, stride=1.0),    # left/front contact
        dict(bob=-1, swing=0.0, stride=0.0),    # passing (up)
        dict(bob=0,  swing=-1.0, stride=-1.0)]  # right/back contact

AUTHOR = {"e": "e", "se": "se", "s": "s", "n": "n", "ne": "ne"}
MIRROR = {"sw": "se", "w": "e", "nw": "ne"}     # horizontal mirrors


def facing_frames(facing, clip):
    if facing in AUTHOR:
        return [pose(AUTHOR[facing], **p) for p in clip]
    src = MIRROR[facing]
    return [pose(src, **p).transpose(0) for p in clip]  # 0 = FLIP_LEFT_RIGHT


# ── Assemble the sheet: rows = (idle 8 facings) then (move 8 facings) ──
COLS = max(len(IDLE), len(MOVE))


def pad(frames):
    blank = sk.Grid(W, H).image()
    return frames + [blank] * (COLS - len(frames))


rows = []
for clip in (IDLE, MOVE):
    for facing in sk.DIR_FRAMES:
        rows.append(pad(facing_frames(facing, clip)))

sheet = sk.save_sheet(rows, os.path.join(OUT, "mob_skeleton_base.png"))
# Preview: the whole sheet, plus a south-facing walk gif for review.
sk.save_preview(sheet, os.path.join(OUT, "skeleton_sheet_preview.png"), scale=8)
sk.save_gif(facing_frames("s", MOVE), os.path.join(OUT, "skeleton_walk_s.gif"), fps=8)
sk.save_gif(facing_frames("e", MOVE), os.path.join(OUT, "skeleton_walk_e.gif"), fps=8)
print(f"skeleton: wrote mob_skeleton_base.png ({sheet.size[0]}x{sheet.size[1]}) "
      f"= idle(2) + move(4) x 8 facings (+ preview, gifs)")

#!/usr/bin/env python3
"""Cyclops boss - one-eyed stone giant. Promoted to front-only clip sheet:
idle(2f@3fps, breathe) + move(4f@8fps, lumbering stomp) + attack(4f@12fps,
club slam). Stays front-facing for now (players approach from the south in iso,
the natural combat-facing).

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

SKIN     = g_("text.dim")
SKIN_SH  = g_("frame.band")
SKIN_DK  = g_("frame.inner")
SKIN_HI  = g_("text.base")
WRAP     = g_("terrain.rock")
CLUB     = g_("text.base")
CLUB_SH  = g_("text.dim")
EYE_RIM  = g_("fire.coal")
EYE_IRIS = g_("fire.mid")
EYE_CORE = g_("fire.core")
TEETH    = g_("text.bright")
OUTLINE  = g_("ink")


def block(g, x0, y0, x1, y1, c):
    for x in range(int(x0), int(x1) + 1):
        for y in range(int(y0), int(y1) + 1):
            g.put(x, y, c)


def frame(bob=0, eye_pulse=0, slam=0.0, stride=0.0):
    g = sk.Grid(W, H)
    b = bob

    # ── Legs ───────────────────────────────────────────────────────
    s = int(round(stride))
    block(g, 6 + s, 21, 9 + s, 26, SKIN)        # left leg (strides)
    block(g, 14 - s, 21, 17 - s, 26, SKIN)      # right leg (strides opposite)
    block(g, 5 + s, 25, 10 + s, 26, SKIN_SH)    # left foot
    block(g, 13 - s, 25, 18 - s, 26, SKIN_SH)   # right foot
    block(g, 9 + s, 21, 9 + s, 25, SKIN_SH)
    block(g, 14 - s, 21, 14 - s, 25, SKIN_SH)

    # ── Hips ───────────────────────────────────────────────────────
    g.poly([(5, 18 - b), (18, 18 - b), (17, 23 - b), (6, 23 - b)], WRAP, edge_lo=OUTLINE)
    block(g, 11, 19 - b, 12, 23 - b, SKIN_DK)

    # ── Torso ──────────────────────────────────────────────────────
    g.poly([(3, 11 - b), (20, 11 - b), (18, 20 - b), (5, 20 - b)], SKIN, edge_lo=SKIN_SH)
    block(g, 4, 9 - b, 19, 12 - b, SKIN)
    g.disc(5.5, 10 - b, 3.2, SKIN)
    g.disc(17.5, 10 - b, 3.2, SKIN)
    block(g, 12, 13 - b, 18, 19 - b, SKIN_SH)
    block(g, 11, 13 - b, 11, 19 - b, SKIN_DK)
    for p in [(5, 9 - b), (6, 9 - b), (5, 10 - b), (4, 11 - b), (7, 12 - b)]:
        g.put(p[0], p[1], SKIN_HI)

    # ── Head ───────────────────────────────────────────────────────
    g.disc(CX, 6 - b, 3.8, SKIN, sq=1.0)
    block(g, 9, 8 - b, 14, 10 - b, SKIN)
    block(g, 8, 3 - b, 15, 3 - b, SKIN_DK)
    g.put(8, 4 - b, SKIN_HI); g.put(9, 3 - b, SKIN_HI)
    for x in (10, 12, 13):
        g.put(x, 10 - b, TEETH)
    g.put(11, 10 - b, SKIN_DK)

    # ── Eye ────────────────────────────────────────────────────────
    g.disc(CX, 6 - b, 3.1, EYE_RIM, sq=1.0)
    g.disc(CX, 6 - b, 2.3, EYE_IRIS, sq=1.0)
    g.disc(CX, 6 - b, 1.2, EYE_CORE, sq=1.0)
    g.put(10, 5 - b, EYE_CORE)
    if eye_pulse:
        g.put(13, 5 - b, EYE_CORE)

    # ── Arms ───────────────────────────────────────────────────────
    slam_x = int(round(slam * 3))
    block(g, 1, 11 - b, 4, 19 - b, SKIN)         # left arm
    block(g, 19, 11 - b, 22, 19 - b, SKIN)       # right arm
    block(g, 1, 11 - b, 1, 19 - b, SKIN_HI)
    block(g, 22, 12 - b, 22, 19 - b, SKIN_SH)
    g.disc(2.5, 20 - b + slam_x, 2.6, SKIN)      # left fist
    g.disc(21.5, 20 - b - slam_x, 2.6, SKIN)     # right fist (club hand)
    g.disc(2.0, 19 - b + slam_x, 1.0, SKIN_HI)
    block(g, 1, 21 - b + slam_x, 4, 21 - b + slam_x, SKIN_SH)
    block(g, 19, 21 - b - slam_x, 22, 21 - b - slam_x, SKIN_SH)

    # ── Club ───────────────────────────────────────────────────────
    # Slam: club swings from over-the-shoulder (slam=0) down to ground (slam=1).
    club_top_y = 5 - b - int(round(slam * 14))
    club_top_x = 23 - int(round(slam * 2))
    g.line(20, 20 - b - slam_x, club_top_x, club_top_y, CLUB, 0.0, 1.0)
    g.line(21, 20 - b - slam_x, club_top_x, club_top_y + 1, CLUB, 0.0, 1.0)
    g.line(19, 20 - b - slam_x, club_top_x - 1, club_top_y + 1, CLUB_SH, 0.0, 1.0)
    knob_cx = club_top_x - 0.4 + 0.5 * (1 - slam)
    knob_cy = club_top_y - 0.6 - slam * 2
    g.disc(knob_cx, knob_cy, 2.4, CLUB)
    g.disc(knob_cx + 0.6, knob_cy + 0.7, 1.2, CLUB_SH)
    g.put(int(knob_cx) - 1, int(knob_cy) - 1, SKIN_HI)
    block(g, 20, 19 - b - slam_x, 21, 21 - b - slam_x, SKIN_DK)  # grip

    g.outline(OUTLINE)
    return g.image()


# ── Clip definitions ───────────────────────────────────────────────
IDLE = [dict(bob=0, eye_pulse=0, slam=0.0, stride=0.0),
        dict(bob=1, eye_pulse=1, slam=0.0, stride=0.0)]   # breathe + eye pulse
MOVE = [dict(bob=-1, eye_pulse=0, slam=0.0, stride=0.0),  # passing
        dict(bob=0, eye_pulse=0, slam=0.0, stride=1.0),    # left foot contact
        dict(bob=-1, eye_pulse=0, slam=0.0, stride=0.0),   # passing
        dict(bob=0, eye_pulse=0, slam=0.0, stride=-1.0)]   # right foot contact
ATTACK = [dict(bob=-1, eye_pulse=1, slam=0.0, stride=0.0),  # wind-up: club over shoulder
          dict(bob=-2, eye_pulse=1, slam=0.4, stride=0.5),   # swing down
          dict(bob=0, eye_pulse=0, slam=1.0, stride=-0.5),   # slam impact
          dict(bob=1, eye_pulse=0, slam=0.3, stride=0.0)]    # recover, club rising


def clip_frames(clip_defs):
    return [frame(**p) for p in clip_defs]


COLS = max(len(IDLE), len(MOVE), len(ATTACK))

def pad(frames):
    blank = sk.Grid(W, H).image()
    return frames + [blank] * (COLS - len(frames))

rows = []
for clip in (IDLE, MOVE, ATTACK):
    rows.append(pad(clip_frames(clip)))

sheet = sk.save_sheet(rows, os.path.join(OUT, "boss_cyclops_s.png"))
sk.save_preview(sheet, os.path.join(OUT, "cyclops_sheet_preview.png"), scale=8)
sk.save_gif(clip_frames(MOVE), os.path.join(OUT, "cyclops_walk.gif"), fps=8)
sk.save_gif(clip_frames(ATTACK), os.path.join(OUT, "cyclops_attack.gif"), fps=12)
print(f"cyclops: wrote boss_cyclops_s.png ({sheet.size[0]}x{sheet.size[1]}) "
      f"= idle(2) + move(4) + attack(4) front-only clips")

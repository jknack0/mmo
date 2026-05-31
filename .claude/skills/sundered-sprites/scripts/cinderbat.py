#!/usr/bin/env python3
"""Cinderbat - flying undead trash mob, front (s) facing, 4-frame wing-flap.
Worked example of the spritekit pattern: symmetric body + computed wings,
hard outline, native 16x16, export strip + preview + gif.
Run:  python scripts/cinderbat.py [out_dir]
"""
import sys, os
import spritekit as sk

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(OUT, exist_ok=True)
W = H = 16
pal = sk.load_palette()
R = sk.roles(pal)

# right-wing membrane outline (points +x from the shoulder); trailing edge scallops back
WING = [(0.0, -1.0), (2.6, -2.0), (4.8, -2.1), (5.8, -1.3),
        (5.2, 0.4), (4.0, 2.1), (3.0, 0.8), (2.0, 2.2), (0.7, 1.1)]
SHOULDER = (8.6, 7.4)

def body(g):
    g.disc(7.5, 6.0, 2.5, R["BONE"], sq=1.05)         # skull
    g.disc(7.5, 10.2, 1.9, R["BONE"], sq=1.15)        # torso
    for p in [(9, 4), (9, 3), (10, 3), (10, 2),       # ears (both sides, explicit)
              (6, 4), (6, 3), (5, 3), (5, 2)]:
        g.put(*p, R["BONE"])
    for p in [(6, 5), (7, 5), (6, 9), (7, 9)]:         # top-left highlights
        g.put(*p, R["BONE_HI"])
    for p in [(8, 8), (9, 7), (8, 11), (9, 11)]:       # bottom-right shadow
        if g.get(*p)[3]:
            g.put(*p, R["BONE_SH"])
    g.put(6, 12, R["OUTLINE"]); g.put(9, 12, R["OUTLINE"])        # feet/claws
    g.put(7, 8, R["MEMBRANE_SH"]); g.put(8, 8, R["MEMBRANE_SH"])  # mouth shadow
    g.put(6, 6, R["EMBER"]); g.put(9, 6, R["EMBER"])              # ember eyes

def wing(g, deg, mirror=False):
    pts = []
    for lx, ly in WING:
        rx, ry = sk.rot(lx, ly, deg)
        x, y = SHOULDER[0] + rx, SHOULDER[1] + ry
        if mirror:
            x = 15 - x
        pts.append((x, y))
    g.poly(pts, R["MEMBRANE"], edge_lo=R["MEMBRANE_SH"])
    g.line(*pts[2], *pts[5], R["BONE_SH"], 0.1, 0.55)  # finger struts
    g.line(*pts[1], *pts[7], R["BONE_SH"], 0.1, 0.55)
    for i in range(3):                                  # warm leading-edge bone
        g.line(*pts[i], *pts[i + 1], R["WING_BONE"])
    g.put(round(pts[3][0]), round(pts[3][1]), R["BONE_HI"])  # tip highlight

def frame(theta):
    g = sk.Grid(W, H)
    wing(g, theta, mirror=False)    # right wing (behind body)
    wing(g, theta, mirror=True)     # left wing
    body(g)                         # body over the wing roots
    g.outline(R["OUTLINE"])
    return g.image()

THETAS = [24, -4, -32, -4]          # down -> mid -> up -> mid
frames = [frame(t) for t in THETAS]

strip = sk.save_strip(frames, os.path.join(OUT, "mob_cinderbat_fly_s.png"))
sk.save_preview(strip, os.path.join(OUT, "cinderbat_preview.png"))
sk.save_gif(frames, os.path.join(OUT, "cinderbat_fly.gif"))
print("cinderbat: wrote mob_cinderbat_fly_s.png (+ preview, gif)")

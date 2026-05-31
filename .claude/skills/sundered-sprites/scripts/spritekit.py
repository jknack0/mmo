"""spritekit — shared toolkit for The Sundered Reaches pixel assets.

Everything here exists so a new generator is a few lines and always comes out
on-style: palette pulled from the repo's tokens, native-res authoring, hard
outline, and game-ready export (transparent strip + preview + gif). Colours
are loaded live from tokens.json when present so the art never drifts from the
design system; the baked FALLBACK is a commit-time copy used if the file
isn't found.
"""
import json, math, os
from PIL import Image

# ---------------------------------------------------------------- palette ----
# Commit-time copy of tokens.json colours (keys without the "color." prefix).
FALLBACK = {
    "void": "#0d0d12", "ink": "#08080b",
    "fire.core": "#fff1c4", "fire.mid": "#ff9f1a", "fire.coal": "#b0301a", "burn": "#ff6a3a",
    "spirit.0": "#3a64a8", "spirit.1": "#6ab0ff", "wrath.0": "#a04a1f", "wrath.1": "#ff8a3a",
    "terrain.grassA": "#2e3a30", "terrain.grassB": "#28342a", "terrain.rock": "#2a1a1a",
    "rarity.white": "#e8e8e8", "rarity.blue": "#6a9bff", "rarity.yellow": "#ffe04a",
    "rarity.green": "#48d06a", "rarity.gold": "#ff9f1a",
    "frame.edge": "#080706", "frame.band": "#2b2420", "frame.inner": "#13100d", "bevel.hi": "#5a4d36",
    "brass.band": "#6e5328", "brass.edge": "#1a120a", "brass.inner": "#241810", "brass.hi": "#a9842f",
    "panel": "#140e0a", "slotFill": "#13100d",
    "text.base": "#d8cdbb", "text.dim": "#8a7f6e", "text.bright": "#f0deba", "text.onAccent": "#1a120a",
}

def _flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(_flatten(v, key + "."))
        elif isinstance(v, str) and v.startswith("#"):
            out[key] = v
    return out

def load_palette(tokens_path=None):
    """Return {token_name: hex}. Prefers a live tokens.json; falls back to baked copy."""
    pal = dict(FALLBACK)
    candidates = [tokens_path] if tokens_path else []
    candidates += ["tokens.json", "assets/tokens.json", "public/assets/tokens.json",
                   "src/assets/tokens.json", "../assets/tokens.json"]
    for p in candidates:
        if not p or not os.path.exists(p):
            continue
        try:
            data = json.load(open(p))
            for k, v in _flatten(data.get("color", {})).items():
                pal[k] = v
            for k, v in _flatten(data.get("theme", {}).get("brass", {}), "brass.").items():
                pal[k.replace("brass.frame", "brass.").replace("brass.bevelHi", "brass.hi")] = v
        except Exception:
            pass
        break
    return pal

def rgba(hex_, a=255):
    h = hex_.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)

def roles(pal):
    """Convenience art-roles mapped to canonical tokens. Override per generator as needed."""
    g = lambda k: rgba(pal[k])
    return dict(
        OUTLINE=g("ink"), VOID=g("void"),
        BONE_HI=g("text.bright"), BONE=g("text.base"), BONE_SH=g("text.dim"),
        MEMBRANE=g("terrain.rock"), MEMBRANE_SH=g("frame.inner"), WING_BONE=g("brass.band"),
        EMBER=g("fire.mid"), EMBER_HOT=g("fire.core"), COAL=g("fire.coal"),
        SPIRIT=g("spirit.1"), WRATH=g("wrath.1"),
    )

T = (0, 0, 0, 0)  # transparent

# Canonical 8-direction frame order. sw/w/nw are horizontal mirrors of se/e/ne.
DIR_FRAMES = ["e", "se", "s", "sw", "w", "nw", "n", "ne"]

# ------------------------------------------------------------------- grid ----
class Grid:
    """A native-resolution RGBA pixel grid. 1 cell = 1 art pixel."""
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[T for _ in range(h)] for _ in range(w)]

    def put(self, x, y, c):
        if 0 <= int(x) < self.w and 0 <= int(y) < self.h:
            self.px[int(x)][int(y)] = c

    def get(self, x, y):
        return self.px[int(x)][int(y)] if 0 <= int(x) < self.w and 0 <= int(y) < self.h else T

    def disc(self, cx, cy, r, c, sq=1.0):
        for x in range(self.w):
            for y in range(self.h):
                if (x - cx) ** 2 + ((y - cy) * sq) ** 2 <= r * r:
                    self.put(x, y, c)

    def line(self, x0, y0, x1, y1, c, t0=0.0, t1=1.0):
        steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
        for s in range(steps + 1):
            t = s / steps
            if t0 <= t <= t1:
                self.put(round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t), c)

    def poly(self, verts, c, edge_lo=None):
        """Even-odd fill of an absolute-coordinate polygon. edge_lo recolours the bottom row."""
        cols = {}
        for x in range(self.w):
            ys = [y for y in range(self.h) if _in_poly(x + 0.5, y + 0.5, verts)]
            if ys:
                cols[x] = ys
        for x, ys in cols.items():
            for y in ys:
                self.put(x, y, edge_lo if (edge_lo and y == max(ys)) else c)

    def mirror_x(self, into_empty=False):
        """Reflect the RIGHT half onto the left about the vertical centre.
        For sprites whose detail is authored on the right half. Use explicit
        per-side pixels instead when you want directional (asymmetric) shading."""
        for x in range(self.w):
            mx = self.w - 1 - x
            if x <= mx:                       # x is left/centre -> destination, skip as source
                continue
            for y in range(self.h):
                if self.px[x][y][3] and (not into_empty or self.px[mx][y][3] == 0):
                    self.px[mx][y] = self.px[x][y]

    def outline(self, c):
        solid = [[self.px[x][y][3] > 0 for y in range(self.h)] for x in range(self.w)]
        for x in range(self.w):
            for y in range(self.h):
                if self.px[x][y][3] == 0 and any(
                    0 <= x + dx < self.w and 0 <= y + dy < self.h and solid[x + dx][y + dy]
                    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1))):
                    self.px[x][y] = c

    def image(self):
        im = Image.new("RGBA", (self.w, self.h), T)
        for x in range(self.w):
            for y in range(self.h):
                im.putpixel((x, y), self.px[x][y])
        return im

def rot(px, py, deg):
    r = math.radians(deg)
    return (px * math.cos(r) - py * math.sin(r), px * math.sin(r) + py * math.cos(r))

def _in_poly(px, py, poly):
    inside, n, j = False, len(poly), len(poly) - 1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi:
            inside = not inside
        j = i
    return inside

# ----------------------------------------------------------------- export ----
def save_strip(frames, path):
    """frames: list of equally-sized PIL images -> one horizontal transparent PNG strip."""
    w, h = frames[0].size
    strip = Image.new("RGBA", (w * len(frames), h), T)
    for i, f in enumerate(frames):
        strip.paste(f, (i * w, 0))
    strip.save(path)
    return strip

def save_sheet(rows, path):
    """rows: list of rows, each a list of equally-sized PIL frames -> one 2D
    transparent PNG. Cell (r,c) lands at (c*w, r*h). Short rows are left-padded
    with transparency so every row spans the widest row's column count.
    This is the layout the engine's clip model expects: rows = state-blocks of
    8 facings, columns = frames."""
    w, h = rows[0][0].size
    cols = max(len(r) for r in rows)
    sheet = Image.new("RGBA", (w * cols, h * len(rows)), T)
    for r, frames in enumerate(rows):
        for c, f in enumerate(frames):
            sheet.paste(f, (c * w, r * h))
    sheet.save(path)
    return sheet


def save_preview(strip, path, scale=12, bg="#0d0d12"):
    w, h = strip.size
    out = Image.new("RGBA", (w * scale, h * scale), rgba(bg))
    out.alpha_composite(strip.resize((w * scale, h * scale), Image.NEAREST))
    out.convert("RGB").save(path)

def save_gif(frames, path, scale=10, fps=9, bg="#0d0d12"):
    out = []
    for f in frames:
        w, h = f.size
        bgim = Image.new("RGBA", (w * scale, h * scale), rgba(bg))
        bgim.alpha_composite(f.resize((w * scale, h * scale), Image.NEAREST))
        out.append(bgim.convert("P", palette=Image.ADAPTIVE))
    out[0].save(path, save_all=True, append_images=out[1:],
                duration=int(1000 / fps), loop=0, disposal=2)

# ---------------------------------------------------- variants & manifest ----
def recolor(src_png, mapping, dst_png):
    """Palette-swap an existing sheet (the ghoul-from-skeleton pattern).
    mapping: {from_hex: to_hex}. Great for batching tiers/rarities."""
    table = {rgba(k)[:3]: rgba(v) for k, v in mapping.items()}
    im = Image.open(src_png).convert("RGBA")
    px = im.load()
    for x in range(im.width):
        for y in range(im.height):
            r, g, b, a = px[x, y]
            if a and (r, g, b) in table:
                px[x, y] = table[(r, g, b)]
    im.save(dst_png)

def manifest_entry(cols, cellW, cellH, frames, anchor, render_scale=2, fps=None, note=""):
    e = {"cols": cols, "rows": 1, "cellW": cellW, "cellH": cellH,
         "frames": frames, "anchor": list(anchor), "renderScale": render_scale}
    if fps:
        e["fps"] = fps
    e["note"] = note
    return e

def clip_manifest_entry(cellW, cellH, anchor, clips, render_scale=2, note=""):
    """Manifest entry for a multi-row clip sheet (idle/move/attack).

    clips: ordered dict-like {state: {"frames": n, "fps": f}} in row order
    (idle, then move, then attack). Each state occupies an 8-facing block of
    rows; this assigns row = i*8 automatically. cols = widest clip; rows = 8 per
    clip. Frame names stay the 8 facings for reference. The renderer reads
    `clips[state] = {frames, fps, row}` and indexes (row+facing)*cols + frame.
    """
    states = list(clips.keys())
    cols = max(c["frames"] for c in clips.values())
    out_clips = {}
    for i, state in enumerate(states):
        c = clips[state]
        out_clips[state] = {"frames": c["frames"], "fps": c["fps"], "row": i * 8}
    return {
        "cols": cols, "rows": len(states) * 8, "cellW": cellW, "cellH": cellH,
        "frames": list(DIR_FRAMES), "anchor": list(anchor),
        "renderScale": render_scale, "clips": out_clips, "note": note,
    }


def upsert_manifest(manifest_path, sheet_name, entry):
    """Add/replace one sheet entry in spritesheet_map.json, preserving the rest."""
    data = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {"sheets": {}}
    data.setdefault("sheets", {})[sheet_name] = entry
    json.dump(data, open(manifest_path, "w"), indent=2)

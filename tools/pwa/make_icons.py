#!/usr/bin/env python3
"""
Generate the Pyra PWA icons (icons/*.png) with Pillow.

A plain flame glyph on the app's dark surface colour (#0b1326, the same
background every page uses) — no text. Three variants:

  icons/pyra-192.png            any-purpose, rounded square, transparent corners
  icons/pyra-512.png            same at 512 px
  icons/pyra-maskable-512.png   full-bleed square for the W3C "maskable" purpose
                                (the launcher applies its own mask; the glyph sits
                                inside the 80 % safe zone)
  icons/apple-touch-icon.png    180 px, full-bleed (iOS rounds it itself)

Run from the repo root: python3 tools/pwa/make_icons.py
Deterministic (no randomness), so re-running produces identical files.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'icons'
SURFACE = (11, 19, 38, 255)        # #0b1326
FLAME_OUTER = (239, 68, 68, 255)   # #ef4444 (Extreme red)
FLAME_MID = (249, 115, 22, 255)    # #f97316 (Very High orange)
FLAME_INNER = (245, 197, 24, 255)  # #f5c518 (High yellow)
SS = 4                             # supersampling factor


def flame_points(cx, cy, w, h, n=240):
    """Closed polygon for a flame: round belly, tip leaning slightly right."""
    pts = []
    for i in range(n):
        t = i / n * 2 * math.pi
        # base teardrop: x = sin(t), y = cos(t); sharpen the top, round the bottom
        x = math.sin(t) * (0.55 + 0.45 * (1 - math.cos(t)) / 2)
        y = -math.cos(t)
        # pinch the tip and bend it to the right
        if y < 0:
            k = (-y) ** 1.6
            x = x * (1 - 0.72 * k) + 0.28 * k
        pts.append((cx + x * w / 2, cy + y * h / 2))
    return pts


def draw_flame(img, cx, cy, size):
    d = ImageDraw.Draw(img)
    d.polygon(flame_points(cx, cy + size * 0.02, size * 0.78, size * 1.00), fill=FLAME_OUTER)
    d.polygon(flame_points(cx, cy + size * 0.12, size * 0.56, size * 0.74), fill=FLAME_MID)
    d.polygon(flame_points(cx, cy + size * 0.24, size * 0.32, size * 0.44), fill=FLAME_INNER)


def make(px, rounded, glyph_frac):
    S = px * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=SURFACE)
    else:
        d.rectangle((0, 0, S - 1, S - 1), fill=SURFACE)
    draw_flame(img, S / 2, S / 2, S * glyph_frac)
    return img.resize((px, px), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    make(192, True, 0.62).save(OUT / 'pyra-192.png', optimize=True)
    make(512, True, 0.62).save(OUT / 'pyra-512.png', optimize=True)
    make(512, False, 0.52).save(OUT / 'pyra-maskable-512.png', optimize=True)
    make(180, False, 0.60).save(OUT / 'apple-touch-icon.png', optimize=True)
    for f in sorted(OUT.glob('*.png')):
        print(f.relative_to(ROOT), f.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()

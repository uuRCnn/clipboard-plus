#!/usr/bin/env python3
"""Crop the popup (and optionally the preview card) out of a test screenshot.
   crop-popup.py in.png out.png [width] [--with-card]"""
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
width = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else None
with_card = '--with-card' in sys.argv
img = Image.open(src).convert('RGB')
W, H = img.size
px = img.load()
BGS = [(31, 31, 34), (251, 251, 253)]


def is_bg(p):
    return any(all(abs(p[i] - b[i]) <= 2 for i in range(3)) for b in BGS)


x0 = 0 if with_card else W // 2
xs, ys = [], []
for y in range(34, H - 120, 2):
    for x in range(x0, W, 2):
        if is_bg(px[x, y]):
            xs.append(x)
            ys.append(y)
pad = 18
box = (max(0, min(xs) - pad), max(0, min(ys) - pad), min(W, max(xs) + pad), min(H, max(ys) + pad))
out = img.crop(box)
if width:
    out = out.resize((width, round(out.height * width / out.width)), Image.LANCZOS)
out.save(dst, optimize=True)
print(dst, out.size)

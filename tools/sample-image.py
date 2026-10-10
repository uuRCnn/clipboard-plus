#!/usr/bin/env python3
"""Write a colourful 1200x800 test image (sharp corners) to argv[1]."""
import sys
from PIL import Image, ImageDraw

W, H = 1200, 800
img = Image.new('RGB', (W, H))
px = img.load()
for y in range(H):
    for x in range(W):
        t = x / W
        px[x, y] = (255, int(159 - 104 * t + 40 * y / H), int(10 + 85 * t))
d = ImageDraw.Draw(img)
d.ellipse((380, 180, 820, 620), fill=(100, 210, 255))
d.polygon([(0, H), (420, 430), (700, 640), (900, 500), (W, H)], fill=(30, 58, 47))
img.save(sys.argv[1])

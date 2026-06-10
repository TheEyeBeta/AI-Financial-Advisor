"""Generate the Open Graph share image (1200x630) for AI Financial Advisor.

One-off build script — run with: python scripts/generate-og-image.py
Output: public/og-image.png
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (19, 24, 32)          # matches dark theme background hsl(215 25% 10%)
FG = (237, 240, 244)       # near-white foreground
MUTED = (148, 158, 172)    # muted foreground
ACCENT = (96, 165, 250)    # brand blue (favicon stroke)
GREEN = (34, 197, 94)      # trend line green (favicon)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

bold = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", 72)
reg = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", 30)

# Brand mark: minimal eye + upward trend, echoing favicon.svg
cx, cy, s = 600, 240, 5.0  # center and scale
d.ellipse([cx - 10 * s, cy - 6 * s, cx + 10 * s, cy + 6 * s], outline=ACCENT, width=6)
trend = [(cx - 6 * s, cy + 4 * s), (cx - 2 * s, cy), (cx + 2 * s, cy + 2 * s), (cx + 6 * s, cy - 4 * s)]
d.line(trend, fill=GREEN, width=8, joint="curve")

# Wordmark
title = "AI Financial Advisor"
tw = d.textlength(title, font=bold)
d.text(((W - tw) / 2, 330), title, font=bold, fill=FG)

tagline = "Educational market analysis, guided learning, and paper trading."
gw = d.textlength(tagline, font=reg)
d.text(((W - gw) / 2, 430), tagline, font=reg, fill=MUTED)

img.save("public/og-image.png", optimize=True)
print("public/og-image.png written")

# -*- coding: utf-8 -*-
"""Generate the full favicon set from the FakeSmile brick-smile logo.

Source: images/mainfav.webp — a cleaner, higher-res re-export of the brand
mark (opaque, white background) supplied specifically for icon generation.
This is DIFFERENT from images/Fakesmile-1.webp (the header/footer logo,
already transparent) — mainfav has a flat white background that must be
removed first, and different crop coordinates since its canvas differs.

Run: python tools/make-favicons.py   (needs Pillow: pip install Pillow)
Re-run this whenever mainfav.webp changes; nothing else needs updating —
every page links the icons by their fixed root-absolute paths.
"""
from PIL import Image, ImageDraw
import os

ROOT = r"C:\Users\user.DESKTOP-VOKI26B\Downloads\fakesmilestore"
SRC = os.path.join(ROOT, "images", "mainfav.webp")
DARK_BG = (5, 5, 5, 255)  # site's #050505 background — matches the logo's own black ring

# The full logo (circular badge + "FAKE SMILE" text banner) turns to
# illegible mush at 16-32px favicon sizes. Use just the bottom "smile" arc
# instead — a brick-textured half-circle with two eye-notches and a smiling
# curve, which reads clearly as a green smiley mark even at 16px.
CROP_BOX = (140, 500, 890, 890)  # found by overlaying a grid on the 1024x1024 source

im = Image.open(SRC).convert("RGB")

# mainfav.webp has a flat white background (no alpha) — remove it via
# flood-fill BEFORE cropping. Flood-filling from the FULL image's corners
# works because the outer ring there is a solid, unbroken ~15-20px black
# circle; flood-filling from a crop's own corners instead breaches the ring
# wherever the crop boundary cuts across a thin/anti-aliased transition
# (this bit us once — the top of CROP_BOX sits right where the text banner's
# bottom edge meets the circle rim, which is JPEG-softened, not solid black).
work = im.copy()
SENTINEL = (255, 0, 255)  # not present anywhere in the real artwork
for seed in [(0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)]:
    ImageDraw.floodfill(work, seed, SENTINEL, thresh=40)

crop = im.crop(CROP_BOX)
work = work.crop(CROP_BOX)
w, h = crop.size
rgba = crop.convert("RGBA")
px_rgba = rgba.load()
px_work = work.load()
for y in range(h):
    for x in range(w):
        if px_work[x, y] == SENTINEL:
            r, g, b, _ = px_rgba[x, y]
            px_rgba[x, y] = (r, g, b, 0)

# Pad to a square canvas (transparent) so the round mark isn't stretched.
side = max(w, h)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(rgba, ((side - w) // 2, (side - h) // 2), rgba)


def save_png(size, path, flatten_bg=None):
    resized = square.resize((size, size), Image.LANCZOS)
    if flatten_bg:
        bg = Image.new("RGBA", resized.size, flatten_bg)
        bg.alpha_composite(resized)
        bg.convert("RGB").save(path, "PNG")
    else:
        resized.save(path, "PNG")


img_dir = os.path.join(ROOT, "images")

# Standard browser + Google search favicons (transparent — sits on white or dark fine).
save_png(16, os.path.join(img_dir, "favicon-16x16.png"))
save_png(32, os.path.join(img_dir, "favicon-32x32.png"))
save_png(48, os.path.join(img_dir, "favicon-48x48.png"))

# iOS home-screen icon: iOS does NOT respect transparency (renders jagged edges
# on some versions) — flatten onto the site's own dark background so it blends
# with the logo's existing black ring instead of showing a white square.
save_png(180, os.path.join(img_dir, "apple-touch-icon.png"), flatten_bg=DARK_BG)

# Android / PWA manifest icons — transparent is fine, Chrome fills its own bg.
save_png(192, os.path.join(img_dir, "android-chrome-192x192.png"))
save_png(512, os.path.join(img_dir, "android-chrome-512x512.png"))

# Multi-resolution favicon.ico (what Google Search + old browsers auto-request
# from /favicon.ico regardless of <link> tags) — 16/32/48/64/128/256 embedded
# together. Pillow's ICO writer resizes the BASE image down for each entry in
# `sizes`, so the base must be at least as large as the biggest requested size
# (256) or the larger frames come out upscaled/blurry — pass the full-res
# square, not a pre-shrunk one.
ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
base_for_ico = square if square.width >= 256 else square.resize((256, 256), Image.LANCZOS)
base_for_ico.save(os.path.join(ROOT, "favicon.ico"), format="ICO", sizes=ico_sizes)

print("Generated:")
print(" ", "favicon.ico", os.path.getsize(os.path.join(ROOT, "favicon.ico")), "bytes")
for f in ["favicon-16x16.png", "favicon-32x32.png", "favicon-48x48.png",
          "apple-touch-icon.png", "android-chrome-192x192.png", "android-chrome-512x512.png"]:
    print(" images/" + f, os.path.getsize(os.path.join(img_dir, f)), "bytes")

# -*- coding: utf-8 -*-
"""Generate a full favicon set from the FakeSmile brick-smile logo."""
from PIL import Image
import os

ROOT = r"C:\Users\user.DESKTOP-VOKI26B\Downloads\fakesmilestore"
SRC = os.path.join(ROOT, "images", "Fakesmile-1.webp")
DARK_BG = (5, 5, 5, 255)  # site's #050505 background — matches the logo's own black ring

im = Image.open(SRC).convert("RGBA")
# The full logo (circular badge + "FAKE SMILE" text banner) turns to illegible
# mush at 16-32px favicon sizes. Use just the bottom "smile" arc instead — a
# brick-textured half-circle with two eye-notches and a smiling curve, which
# reads clearly as a green smiley mark even at 16px. (Coordinates found by
# overlaying a grid on the 1200x908 source — see git history if re-deriving.)
im = im.crop((145, 470, 1035, 905))
w, h = im.size

# Pad to a square canvas (transparent) so the round mark isn't stretched/cropped.
side = max(w, h)
pad_x = (side - w) // 2
pad_y = (side - h) // 2
canvas_size = side
square = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
square.paste(im, (pad_x, pad_y), im)

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
for f in ["favicon.ico"]:
    print(" ", f, os.path.getsize(os.path.join(ROOT, f)), "bytes")
for f in ["favicon-16x16.png", "favicon-32x32.png", "favicon-48x48.png",
          "apple-touch-icon.png", "android-chrome-192x192.png", "android-chrome-512x512.png"]:
    print(" images/" + f, os.path.getsize(os.path.join(img_dir, f)), "bytes")

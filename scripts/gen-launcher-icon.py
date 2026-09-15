#!/usr/bin/env python3
"""Generate the Android launcher icon from src/assets/logo.svg.

Renders the SVG on white via headless Chrome (forcing sRGB so the badge blue is exact),
flood-fills the outer margin to the brand blue - the enclosed envelope stays white - then
writes the legacy mipmaps (square + round) and the adaptive foreground for every density.
The adaptive background is the solid brand blue (res/values/ic_launcher_background.xml).

Requires: google-chrome-stable + Pillow.  Run from the repo root:
    python3 scripts/gen-launcher-icon.py
"""
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG = os.path.join(ROOT, 'src/assets/logo.svg')
RES = os.path.join(ROOT, 'android/app/src/main/res')
BLUE = (0x25, 0x63, 0xA6)  # #2563A6


def render(size=1024):
    out = tempfile.mktemp(suffix='.png')
    subprocess.run(
        [
            'google-chrome-stable', '--headless=new', f'--screenshot={out}',
            f'--window-size={size},{size}', '--default-background-color=ffffffff',
            '--force-device-scale-factor=1', '--force-color-profile=srgb',
            '--hide-scrollbars', f'file://{SVG}',
        ],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return Image.open(out).convert('RGB')


def circle_crop(im):
    im = im.convert('RGBA')
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, im.size[0] - 1, im.size[1] - 1], fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


full = render()
w, h = full.size
for corner in [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)]:
    ImageDraw.floodfill(full, corner, BLUE, thresh=120)

LEGACY = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FOREGROUND = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
for d, sz in LEGACY.items():
    full.resize((sz, sz), Image.LANCZOS).convert('RGB').save(f'{RES}/mipmap-{d}/ic_launcher.png')
    circle_crop(full.resize((sz, sz), Image.LANCZOS)).save(f'{RES}/mipmap-{d}/ic_launcher_round.png')
for d, sz in FOREGROUND.items():
    full.convert('RGBA').resize((sz, sz), Image.LANCZOS).save(
        f'{RES}/mipmap-{d}/ic_launcher_foreground.png'
    )
print('launcher icons written')

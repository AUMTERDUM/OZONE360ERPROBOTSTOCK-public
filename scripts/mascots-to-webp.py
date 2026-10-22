"""Convert generated mascot PNGs in public/mascots/ to 512x512 transparent WebP (see docs/mascots.md).

Keeps the aspect ratio (pads to a square, robot anchored to the bottom so CSS motion pivots
from its base) and deletes the PNG once the WebP is written. Usage: python scripts/mascots-to-webp.py
"""
from pathlib import Path
from PIL import Image

SIZE = 512
MARGIN = 0.04  # keep a little air around the robot
folder = Path(__file__).resolve().parent.parent / 'public' / 'mascots'

for png in sorted(folder.glob('*.png')):
    im = Image.open(png).convert('RGBA')
    bbox = im.getbbox()  # trim fully transparent borders
    if bbox:
        im = im.crop(bbox)
    inner = int(SIZE * (1 - 2 * MARGIN))
    im.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    x = (SIZE - im.width) // 2
    y = SIZE - int(SIZE * MARGIN) - im.height
    canvas.paste(im, (x, y), im)
    out = png.with_suffix('.webp')
    canvas.save(out, 'WEBP', quality=86, method=6)
    png.unlink()
    print(f'{out.name}: {out.stat().st_size // 1024} KB')

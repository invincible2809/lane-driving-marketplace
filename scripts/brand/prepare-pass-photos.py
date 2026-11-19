"""Prepares learner pass photos for the website reel.

Rotates each photo upright, resizes it to 600 x 800 (3:4), and saves a
progressive JPEG with ALL metadata removed (phone photos can carry GPS
location, device and time data).

Usage: pip install pillow && python3 scripts/brand/prepare-pass-photos.py <folder-of-originals>
Files are processed in natural name order (pass-1, pass-2, …, pass-10) and
written as public/site/passes/pass-01.jpg, pass-02.jpg, ….
Only publish photos the learners have agreed to share.
"""
import re, sys
from pathlib import Path
from PIL import Image, ImageOps

src = Path(sys.argv[1])
out = Path(__file__).resolve().parents[2] / 'public/site/passes'
out.mkdir(parents=True, exist_ok=True)
for old in out.glob('pass-*.jpg'):
    old.unlink()
key = lambda p: [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', p.name)]
files = sorted([p for p in src.iterdir() if p.is_file() and p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp', '.raw')], key=key)
total = 0
for i, path in enumerate(files, 1):
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    im = ImageOps.fit(im, (600, 800), Image.LANCZOS, centering=(0.5, 0.45))
    clean = Image.new('RGB', im.size); clean.paste(im)          # drops every metadata block
    target = out / f'pass-{i:02d}.jpg'
    clean.save(target, 'JPEG', quality=76, optimize=True, progressive=True)
    total += target.stat().st_size
    print(f'{path.name} -> {target.name} {target.stat().st_size // 1024} KB')
print(f'{len(files)} photos, {total // 1024} KB in total')

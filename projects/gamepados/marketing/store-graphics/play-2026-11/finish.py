"""Final pass for the Play Console upload (2026-11-18): checks every Google Play rule and writes the upload folder.

    python finish.py [lang]   -> projects/gamepados/releases/2.0.0/play-store-graphics/<lang>/  (inside HP, git-ignored)

Play rules checked: screenshots JPEG or 24-bit PNG with no transparency, each side 320-3840 px, long side at most
2x the short side, max 8 MB; feature graphic exactly 1024x500, no transparency, max 15 MB; icon 512x512 32-bit PNG, max 1 MB.
"""
import os, sys, glob, shutil
from PIL import Image

LANG = sys.argv[1] if len(sys.argv) > 1 else 'en'
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'out', f'{LANG}-4k' + ('-poco' if os.environ.get('PHONE') == 'poco' else ''))
DST = os.path.join(HERE, '..', '..', '..', 'releases', '2.0.0', 'play-store-graphics', LANG)
shutil.rmtree(DST, ignore_errors=True); os.makedirs(DST)
MB = 1024 * 1024

def save_shot(im, base):
    im = im.convert('RGB')                       # drop any alpha: Play wants 24-bit
    p = os.path.join(DST, base + '.png')
    im.save(p, optimize=True)
    if os.path.getsize(p) > 7.5 * MB:            # too big for Play's 8 MB: near-lossless JPEG instead
        os.remove(p); p = os.path.join(DST, base + '.jpg')
        im.save(p, quality=96, subsampling=0, optimize=True)
    return p

def check(p, kind):
    im = Image.open(p); w, h = im.size; size = os.path.getsize(p)
    ok = im.mode == 'RGB'
    if kind == 'shot': ok &= 320 <= min(w, h) and max(w, h) <= 3840 and max(w, h) <= 2 * min(w, h) and size <= 8 * MB
    if kind == 'feature': ok &= (w, h) == (1024, 500) and size <= 15 * MB
    if kind == 'icon': ok = im.mode == 'RGBA' and (w, h) == (512, 512) and size <= 1 * MB
    print(('OK  ' if ok else 'FAIL'), os.path.basename(p), f'{w}x{h}', im.mode, f'{size / MB:.2f} MB')
    return ok

good = True
for f in sorted(glob.glob(os.path.join(SRC, '[0-9][0-9]-*.png'))):
    good &= check(save_shot(Image.open(f), os.path.splitext(os.path.basename(f))[0]), 'shot')

hi = Image.open(os.environ.get('FEATURE') or os.path.join(HERE, 'out', LANG, 'feature-graphic-hires.png')).convert('RGB')
fg = os.path.join(DST, 'feature-graphic-1024x500.png')
hi.resize((1024, 500), Image.LANCZOS).save(fg, optimize=True)
good &= check(fg, 'feature')

icon = os.path.join(DST, 'app-icon-512.png')
Image.open(os.path.join(HERE, '..', 'play-icon-512.png')).convert('RGBA').save(icon, optimize=True)
good &= check(icon, 'icon')
print('ALL GOOD' if good else 'SOMETHING FAILED')

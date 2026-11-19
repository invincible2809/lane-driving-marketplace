"""Builds the SRK Driving School logo files.

Recreates SRK's existing logo as seen on the school's car signs: two slanted
stripes (light and deep orange) above "SRK DRIVING SCHOOL" in a heavy
geometric typeface (Poppins ExtraBold, SIL Open Font Licence 1.1, copy and
licence in scripts/brand/fonts/). Lettering is converted to outlines, so the
SVGs look identical everywhere without loading web fonts.

Usage: pip install fonttools brotli uharfbuzz && python3 scripts/brand/build-logo.py
Then:  node scripts/brand/render-icons.mjs   (PNG icons)
Output: public/site/brand/*.svg
"""
import io
from pathlib import Path
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/site/brand'
LIGHT, DEEP = '#fcb074', '#fc5c00'          # sampled from the car signage
BLACK, WHITE = '#0a0a0a', '#ffffff'

class Face:
    def __init__(self, path):
        font = TTFont(path); font.flavor = None
        buf = io.BytesIO(); font.save(buf)
        self.font = TTFont(io.BytesIO(buf.getvalue()))
        self.hb_font = hb.Font(hb.Face(buf.getvalue()))
        self.glyphs = self.font.getGlyphSet(); self.order = self.font.getGlyphOrder()
        self.upem = self.font['head'].unitsPerEm; self.cap = self.font['OS/2'].sCapHeight
    def measure(self, text, cap_px, tracking=0.0):
        return self.path(text, cap_px, 0, 0, tracking)[1]
    def path(self, text, cap_px, x, baseline, tracking=0.0):
        """SVG path data for text whose capitals are cap_px tall. Returns (d, width)."""
        buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
        hb.shape(self.hb_font, buf, {'kern': True})
        s = cap_px / self.cap; track = tracking * self.upem
        pen = SVGPathPen(self.glyphs, ntos=lambda v: f'{v:.2f}'.rstrip('0').rstrip('.'))
        cursor = 0.0; n = len(buf.glyph_infos)
        for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
            self.glyphs[self.order[info.codepoint]].draw(TransformPen(pen, (s, 0, 0, -s, x + (cursor + pos.x_offset) * s, baseline - pos.y_offset * s)))
            cursor += pos.x_advance + (track if i < n - 1 else 0)
        return pen.getCommands(), cursor * s

poppins = Face(ROOT / 'scripts/brand/fonts/poppins-latin-800-normal.woff2')

# Stripe geometry traced from the car sign, in a 421 x 228 box.
STRIPES_W, STRIPES_H = 421.0, 228.0
TOP = [(168, 0), (323, 0), (155, 152), (0, 152)]
BOTTOM = [(266, 75), (421, 75), (253, 228), (98, 228)]
def stripes(x, y, height, light=LIGHT, deep=DEEP):
    k = height / STRIPES_H
    pts = lambda poly: ' '.join(f'{x + px * k:.2f},{y + py * k:.2f}' for px, py in poly)
    return f'<polygon points="{pts(TOP)}" fill="{light}"/><polygon points="{pts(BOTTOM)}" fill="{deep}"/>'
def stripes_width(height): return STRIPES_W * height / STRIPES_H

def svg(width, height, body, title='SRK Driving School'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.2f} {height:.2f}" width="{width:.0f}" height="{height:.0f}" role="img" aria-labelledby="t">'
            f'<title id="t">{title}</title>{body}</svg>\n')

def horizontal(ink, light=LIGHT, deep=DEEP):
    """Website header: [stripes]  SRK / DRIVING SCHOOL"""
    H = 64.0
    mark_h = 46.0; mark_w = stripes_width(mark_h)
    srk_cap, sub_cap, gap = 27.0, 11.5, 9.0
    top = (H - (srk_cap + gap + sub_cap)) / 2
    tx = mark_w + 14
    srk, srk_w = poppins.path('SRK', srk_cap, tx, top + srk_cap, tracking=0.02)
    sub, sub_w = poppins.path('DRIVING SCHOOL', sub_cap, tx, top + srk_cap + gap + sub_cap, tracking=0.04)
    width = tx + max(srk_w, sub_w) + 1
    return svg(width, H, stripes(0, (H - mark_h) / 2, mark_h, light, deep) + f'<path d="{srk} {sub}" fill="{ink}"/>')

def stacked(ink, panel=None, light=LIGHT, deep=DEEP):
    """As on the car sign: stripes, then SRK, then DRIVING SCHOOL, centred."""
    pad = 28.0 if panel else 0.0
    sub_cap = 30.0
    sub_w = poppins.measure('DRIVING SCHOOL', sub_cap)
    W = sub_w + pad * 2
    mark_h = 0.62 * sub_w * STRIPES_H / STRIPES_W
    mark_w = stripes_width(mark_h)
    srk_cap = sub_cap
    y_mark = pad; y_srk = y_mark + mark_h + 26 + srk_cap; y_sub = y_srk + 14 + sub_cap
    srk_w = poppins.measure('SRK', srk_cap)
    srk, _ = poppins.path('SRK', srk_cap, (W - srk_w) / 2, y_srk)
    sub, _ = poppins.path('DRIVING SCHOOL', sub_cap, pad, y_sub)
    H = y_sub + pad + (4 if not panel else 0)
    bg = f'<rect width="{W:.2f}" height="{H:.2f}" fill="{panel}"/>' if panel else ''
    return svg(W, H, bg + stripes((W - mark_w) / 2, y_mark, mark_h, light, deep) + f'<path d="{srk} {sub}" fill="{ink}"/>')

def icon(rounded=True):
    """Stripes on a black tile: favicon and app icon."""
    S = 64.0; mark_h = 33.0; mark_w = stripes_width(mark_h)
    rx = ' rx="13"' if rounded else ''
    return svg(S, S, f'<rect width="64" height="64"{rx} fill="{BLACK}"/>' + stripes((S - mark_w) / 2, (S - mark_h) / 2, mark_h))

OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob('srk-*.svg'):
    old.unlink()
files = {
    'srk-logo-on-dark.svg': horizontal(WHITE),                 # website and app header
    'srk-logo-on-light.svg': horizontal(BLACK),                # white backgrounds, letters
    'srk-logo-black.svg': horizontal(BLACK, BLACK, BLACK),     # one colour (print, stamps)
    'srk-logo-stacked-on-dark.svg': stacked(WHITE),            # square spaces on dark
    'srk-logo-stacked-on-light.svg': stacked(BLACK),           # square spaces on white
    'srk-logo-sign.svg': stacked(WHITE, panel=BLACK),          # the car-sign panel itself
    'srk-mark.svg': icon(True),                                # favicon
    'srk-app-icon.svg': icon(False),                           # phone home screen (phone rounds it)
}
for name, content in files.items():
    (OUT / name).write_text(content)
    print(f'{name}: {len(content)} bytes')

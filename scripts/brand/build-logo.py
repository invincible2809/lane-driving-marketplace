"""Builds the SRK Driving School logo files from the site's own fonts.

Lettering is converted to outlines, so the SVGs look identical everywhere
(including as <img>, in emails and in print) without loading web fonts.
Fonts: Archivo and Atkinson Hyperlegible, both SIL Open Font Licence 1.1.

Usage: pip install fonttools brotli uharfbuzz && python3 scripts/brand/build-logo.py
Output: public/site/brand/*.svg
"""
import io
from pathlib import Path
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parents[2]
FONTS = ROOT / 'public/site/fonts'
OUT = ROOT / 'public/site/brand'
YELLOW, BLACK, WHITE = '#f9e615', '#0a0a0a', '#fafafa'

class Face:
    def __init__(self, file, axes=None):
        font = TTFont(FONTS / file)
        if axes:
            font = instancer.instantiateVariableFont(font, axes)
        buf = io.BytesIO(); font.flavor = None; font.save(buf)
        self.font = TTFont(io.BytesIO(buf.getvalue()))
        self.hb_font = hb.Font(hb.Face(buf.getvalue()))
        self.glyphs = self.font.getGlyphSet()
        self.order = self.font.getGlyphOrder()
        self.upem = self.font['head'].unitsPerEm
        self.cap = self.font['OS/2'].sCapHeight

    def path(self, text, cap_px, x, baseline, tracking=0.0):
        """SVG path data for text whose capital letters are cap_px tall. Returns (d, width)."""
        buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
        hb.shape(self.hb_font, buf, {'kern': True, 'liga': False})
        s = cap_px / self.cap
        track = tracking * self.upem
        pen = SVGPathPen(self.glyphs, ntos=lambda v: f'{v:.2f}'.rstrip('0').rstrip('.'))
        cursor = 0.0
        infos, positions = buf.glyph_infos, buf.glyph_positions
        for i, (info, pos) in enumerate(zip(infos, positions)):
            name = self.order[info.codepoint]
            gx = x + (cursor + pos.x_offset) * s
            self.glyphs[name].draw(TransformPen(pen, (s, 0, 0, -s, gx, baseline - pos.y_offset * s)))
            cursor += pos.x_advance + (track if i < len(infos) - 1 else 0)
        return pen.getCommands(), cursor * s

archivo = Face('archivo-latin-wdth-normal.woff2', {'wght': 900, 'wdth': 75})
atkinson = Face('atkinson-hyperlegible-latin-700-normal.woff2')

def road_mark(x=0, y=0, size=64, plate=YELLOW, road=BLACK, line=YELLOW, uid='m'):
    """Rounded yellow plate with a straight road running to a flat horizon and a
    dashed centre line (echoes the road in the website's home-page hero)."""
    k = size / 64
    def P(px, py): return f'{x + px * k:.2f},{y + py * k:.2f}'
    horizon, bottom, cx = 20.0, 68.0, 32.0
    half = lambda py: 4.2 + (py - horizon) / (bottom - horizon) * (34.0 - 4.2)   # road half-width
    at = lambda t: bottom - (bottom - horizon) * t                                 # t: 0 bottom, 1 horizon
    road_pts = ' '.join([P(cx - half(bottom), bottom), P(cx + half(bottom), bottom), P(cx + half(horizon), horizon), P(cx - half(horizon), horizon)])
    dashes = []
    for ta, tb in [(0.0, 0.12), (0.22, 0.31), (0.40, 0.47), (0.55, 0.60), (0.67, 0.71), (0.77, 0.80)]:
        ya, yb = at(ta), at(tb)
        wa, wb = half(ya) * 0.15, half(yb) * 0.15
        dashes.append(f'<polygon points="{P(cx - wa, ya)} {P(cx + wa, ya)} {P(cx + wb, yb)} {P(cx - wb, yb)}" fill="{line}"/>')
    r = 13 * k
    return (f'<clipPath id="{uid}"><rect x="{x:.2f}" y="{y:.2f}" width="{size:.2f}" height="{size:.2f}" rx="{r:.2f}"/></clipPath>'
            f'<rect x="{x:.2f}" y="{y:.2f}" width="{size:.2f}" height="{size:.2f}" rx="{r:.2f}" fill="{plate}"/>'
            f'<g clip-path="url(#{uid})"><polygon points="{road_pts}" fill="{road}"/>{"".join(dashes)}</g>')

def svg(width, height, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.2f} {height:.2f}" width="{width:.0f}" height="{height:.0f}" role="img" aria-labelledby="t">'
            f'<title id="t">{title}</title>{body}</svg>\n')

def horizontal(ink, plate=YELLOW, road=BLACK, line=YELLOW, sub=None):
    """[road mark] SRK  DRIVING / SCHOOL"""
    H, cap = 64.0, 44.0
    top = (H - cap) / 2                       # SRK capitals centred on the mark
    base = top + cap
    srk, srk_w = archivo.path('SRK', cap, 78, base, tracking=0.01)
    sub_cap = 17.6
    x2 = 78 + srk_w + 11
    l1, w1 = atkinson.path('DRIVING', sub_cap, x2, top + sub_cap, tracking=0.09)
    l2, w2 = atkinson.path('SCHOOL', sub_cap, x2, base, tracking=0.09)
    width = x2 + max(w1, w2) + 1
    body = (road_mark(0, 0, H, plate, road, line, uid='hm') +
            f'<path d="{srk}" fill="{ink}"/><path d="{l1} {l2}" fill="{sub or ink}"/>')
    return svg(width, H, body, 'SRK Driving School')

def stacked(ink):
    """Mark above the name, for square spaces (social profile, documents)."""
    W = 200.0
    mark = road_mark((W - 96) / 2, 0, 96, uid='sm')
    srk_cap, sub_cap = 40.0, 13.0
    _, srk_w = archivo.path('SRK', srk_cap, 0, 0, tracking=0.01)
    srk, _ = archivo.path('SRK', srk_cap, (W - srk_w) / 2, 96 + 18 + srk_cap, tracking=0.01)
    _, sub_w = atkinson.path('DRIVING SCHOOL', sub_cap, 0, 0, tracking=0.12)
    sub, _ = atkinson.path('DRIVING SCHOOL', sub_cap, (W - sub_w) / 2, 96 + 18 + srk_cap + 12 + sub_cap, tracking=0.12)
    return svg(W, 96 + 18 + srk_cap + 12 + sub_cap + 2, mark + f'<path d="{srk} {sub}" fill="{ink}"/>', 'SRK Driving School')

OUT.mkdir(parents=True, exist_ok=True)
files = {
    'srk-logo-on-dark.svg': horizontal(WHITE),                                    # website header, dark pages
    'srk-logo-on-light.svg': horizontal(BLACK),                                   # white backgrounds, documents
    'srk-logo-black.svg': horizontal(BLACK, plate=BLACK, road=YELLOW, line=BLACK),  # one colour on yellow
    'srk-logo-stacked-on-dark.svg': stacked(WHITE),
    'srk-logo-stacked-on-light.svg': stacked(BLACK),
    'srk-mark.svg': svg(64, 64, road_mark(uid='mk'), 'SRK Driving School'),       # favicon / app icon
}
# Square, full-bleed icon for phone home screens (the phone rounds the corners itself).
full_bleed = road_mark(uid='ab').replace('rx="13.00"', 'rx="0"')
files['srk-app-icon.svg'] = svg(64, 64, full_bleed, 'SRK Driving School')
for name, content in files.items():
    (OUT / name).write_text(content)
    print(f'{name}: {len(content)} bytes')

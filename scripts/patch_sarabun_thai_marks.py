#!/usr/bin/env python3
"""
Adds the stacked-mark glyph variants of Sarabun to its cmap (as Private Use code points) and re-writes
utils/sarabunFont.ts.

Why: jsPDF does no OpenType shaping (no GSUB/GPOS), so a tone mark over an upper vowel ("ชั้น", "นี้"), marks over
tall consonants ("ป้", "ฟู่") and lower vowels under ญ ฐ ฎ ฏ are drawn on top of each other. Sarabun already contains
the right glyphs (".small", ".narrow", ".less", ".short", ligatures) but they are only reachable through GSUB. Mapping
them to code points lets utils/thaiMarks.ts pick them explicitly.

The code point scheme MUST match utils/thaiMarks.ts:
  small   0xF800 + (cp - 0x0E00)     cp in E38-E3A, E48-E4C
  narrow  0xF880 + (cp - 0x0E00)     cp in E31, E34-E37, E47-E4D
  short   0xF900 + (cp - 0x0E00)     cp in E0D, E0E, E0F, E10
  nikhahit+tone ligature  0xF980 + (tone - 0xE48)   (narrow: 0xF990 + ...)   tone in E48-E4B

Usage: python3 scripts/patch_sarabun_thai_marks.py   (needs fontTools)
Idempotent: already-patched fonts are patched again with the same result.
"""
import base64, io, re, sys, pathlib
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGET = ROOT / 'utils' / 'sarabunFont.ts'

SHORT_GLYPHS = {0x0E0D: 'yoYingthai.less', 0x0E0E: 'doChadathai.short', 0x0E0F: 'toPatakthai.short', 0x0E10: 'thoThanthai.less'}

def wanted():
    m = {}
    for cp in [0x0E38, 0x0E39, 0x0E3A, 0x0E48, 0x0E49, 0x0E4A, 0x0E4B, 0x0E4C]:
        m[0xF800 + cp - 0x0E00] = f'uni{cp:04X}.small'
    for cp in [0x0E31, 0x0E34, 0x0E35, 0x0E36, 0x0E37, 0x0E47, 0x0E48, 0x0E49, 0x0E4A, 0x0E4B, 0x0E4C, 0x0E4D]:
        m[0xF880 + cp - 0x0E00] = f'uni{cp:04X}.narrow'
    for cp, name in SHORT_GLYPHS.items():
        m[0xF900 + cp - 0x0E00] = name
    for tone in [0x0E48, 0x0E49, 0x0E4A, 0x0E4B]:
        m[0xF980 + tone - 0x0E48] = f'uni0E4D{tone:04X}'
        m[0xF990 + tone - 0x0E48] = f'uni0E4D{tone:04X}.narrow'
    return m

def patch(b64: str) -> str:
    font = TTFont(io.BytesIO(base64.b64decode(b64)))
    order = set(font.getGlyphOrder())
    for code, glyph in wanted().items():
        if glyph not in order:
            sys.exit(f'glyph {glyph} missing from font')
        for t in font['cmap'].tables:
            if t.isUnicode():
                t.cmap[code] = glyph
    out = io.BytesIO()
    font.save(out)
    return base64.b64encode(out.getvalue()).decode('ascii')

src = TARGET.read_text(encoding='utf-8')
for const in ['SARABUN_REGULAR_BASE64', 'SARABUN_BOLD_BASE64']:
    m = re.search(rf'({const}\s*=\s*")([^"]+)(")', src)
    if not m:
        sys.exit(f'{const} not found')
    src = src[:m.start(2)] + patch(m.group(2)) + src[m.end(2):]
TARGET.write_text(src, encoding='utf-8')
print('patched', TARGET)

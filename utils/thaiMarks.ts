/**
 * jsPDF cannot shape Thai (no OpenType GSUB/GPOS), so stacked marks collide: "ชั้น" draws the tone mark on top of
 * mai han-akat, "ป้" hits the tall stroke, "ฐุ" overlaps the tail. Sarabun has the correct glyph variants; the font
 * patched by scripts/patch_sarabun_thai_marks.py maps them to Private Use code points and this function picks them
 * with the same rules the font's GSUB table uses. Only use the result for jsPDF text (never store or search it).
 *
 * The code point scheme MUST match the script.
 */
const SMALL = 0xf800;   // + (cp - 0x0E00)
const NARROW = 0xf880;
const SHORT = 0xf900;
const NIK_TONE = 0xf980; // + (tone - 0xE48); narrow: + 0x10

const isTall = (c: number) => c === 0x0e1b || c === 0x0e1d || c === 0x0e1f;           // ป ฝ ฟ
const isUpperVowel = (c: number) => c === 0x0e31 || (c >= 0x0e34 && c <= 0x0e37) || c === 0x0e47; // ั ิ ี ึ ื ็
const isTone = (c: number) => c >= 0x0e48 && c <= 0x0e4b;                              // ่ ้ ๊ ๋
const isThanthakhat = (c: number) => c === 0x0e4c;                                     // ์
const isNikhahit = (c: number) => c === 0x0e4d;                                        // ํ
const isLowerVowel = (c: number) => c === 0x0e38 || c === 0x0e39 || c === 0x0e3a;      // ุ ู ฺ
const isConsonant = (c: number) => c >= 0x0e01 && c <= 0x0e2e;
const TAIL_LESS = new Set([0x0e0d, 0x0e10]);   // ญ ฐ: tail removed, lower vowel stays
const TAIL_SHORT = new Set([0x0e0e, 0x0e0f]);  // ฎ ฏ: tail shortened, lower vowel moves down

export const fixThaiMarks = (text: string): string => {
  if (!text || !/[ั-๎]/.test(text)) return text;
  const cps = Array.from(text, ch => ch.codePointAt(0)!);
  const out: number[] = [];
  let base = 0; // last consonant (start of the current cluster)
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    const prev = i > 0 ? cps[i - 1] : 0;
    if (isConsonant(c)) { base = c; out.push(c); continue; }

    if (isLowerVowel(c)) {
      if (TAIL_LESS.has(base) && isConsonant(prev)) {
        out[out.length - 1] = SHORT + (base - 0x0e00);
        out.push(c);
      } else if (TAIL_SHORT.has(base) && isConsonant(prev)) {
        out[out.length - 1] = SHORT + (base - 0x0e00);
        out.push(SMALL + (c - 0x0e00));
      } else out.push(c);
      continue;
    }

    if (isNikhahit(c)) {
      const next = cps[i + 1];
      if (next !== undefined && isTone(next)) {          // ํ + tone -> one ligature glyph
        out.push(NIK_TONE + (next - 0x0e48) + (isTall(base) ? 0x10 : 0));
        i++;
      } else out.push(isTall(base) && isConsonant(prev) ? NARROW + (c - 0x0e00) : c);
      continue;
    }

    if (isUpperVowel(c)) {
      out.push(isTall(base) && isConsonant(prev) ? NARROW + (c - 0x0e00) : c);
      continue;
    }

    if (isTone(c) || isThanthakhat(c)) {
      if (isUpperVowel(prev)) out.push(SMALL + (c - 0x0e00));            // raised above the vowel
      else if (isTall(base) && isConsonant(prev)) out.push(NARROW + (c - 0x0e00));
      else if (isLowerVowel(prev) && isTall(base)) out.push(NARROW + (c - 0x0e00));
      else out.push(c);
      continue;
    }
    out.push(c);
  }
  return String.fromCodePoint(...out);
};

/**
 * Makes `doc.text(...)` (and therefore jspdf-autotable, which draws through it) apply fixThaiMarks.
 * Call once right after registering the Sarabun fonts. Safe to call twice.
 */
export const enableThaiMarkFix = <D extends { text: (...args: any[]) => any }>(doc: D): D => {
  const d = doc as any;
  if (d.__thaiMarkFix) return doc;
  const original = d.text.bind(d);
  d.text = (text: any, ...rest: any[]) =>
    original(Array.isArray(text) ? text.map(t => (typeof t === 'string' ? fixThaiMarks(t) : t)) : typeof text === 'string' ? fixThaiMarks(text) : text, ...rest);
  d.__thaiMarkFix = true;
  return doc;
};

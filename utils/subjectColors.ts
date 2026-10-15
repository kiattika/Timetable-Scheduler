// Colour helpers for bulk-colouring subjects (same colour / shade gradient / per-department hue)

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const hexToHsl = (hex: string): { h: number; s: number; l: number } => {
  let m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) {
    const short = /^#?([0-9a-f]{3})$/i.exec((hex || '').trim());
    if (!short) return { h: 210, s: 70, l: 50 };
    m = [short[0], short[1].split('').map(c => c + c).join('')] as unknown as RegExpExecArray;
  }
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
};

export const hslToHex = (h: number, s: number, l: number): string => {
  const S = clamp(s, 0, 100) / 100, L = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`.toUpperCase();
};

/** n shades of the same hue, from dark to light. n=1 returns the base colour. */
export const shadesOf = (baseHex: string, n: number): string[] => {
  if (n <= 0) return [];
  if (n === 1) return [baseHex.toUpperCase()];
  const { h, s } = hexToHsl(baseHex);
  const sat = Math.max(s, 45);
  const from = 32, to = 78;
  return Array.from({ length: n }, (_, i) => hslToHex(h, sat, from + ((to - from) * i) / (n - 1)));
};

/** A distinct base colour for the i-th group (golden-angle hue spacing). */
export const groupBaseColor = (index: number): string => hslToHex((index * 137.508 + 15) % 360, 65, 52);

export type SubjectColorMode = 'solid' | 'gradient' | 'byDepartment';

/**
 * Computes new colours for the given subjects (already in the desired order).
 * Returns a Map subjectId -> hex.
 */
export const computeSubjectColors = (
  subjects: { id: string; department?: string }[],
  mode: SubjectColorMode,
  baseColor: string
): Map<string, string> => {
  const out = new Map<string, string>();
  if (mode === 'solid') {
    subjects.forEach(s => out.set(s.id, baseColor.toUpperCase()));
  } else if (mode === 'gradient') {
    const sh = shadesOf(baseColor, subjects.length);
    subjects.forEach((s, i) => out.set(s.id, sh[i]));
  } else {
    const depts = Array.from(new Set(subjects.map(s => s.department || ''))).sort((a, b) => a.localeCompare(b, 'th'));
    depts.forEach((d, di) => {
      const group = subjects.filter(s => (s.department || '') === d);
      const sh = shadesOf(groupBaseColor(di), group.length);
      group.forEach((s, i) => out.set(s.id, sh[i]));
    });
  }
  return out;
};

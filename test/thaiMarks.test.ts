import { describe, it, expect } from 'vitest';
import { fixThaiMarks } from '../utils/thaiMarks';

const cps = (s: string) => Array.from(s, c => c.codePointAt(0)!.toString(16));

describe('fixThaiMarks', () => {
  it('leaves text without stacked marks alone', () => {
    expect(fixThaiMarks('ตารางเรียน')).toBe('ตารางเรียน');
    expect(fixThaiMarks('Math 101')).toBe('Math 101');
    expect(fixThaiMarks('')).toBe('');
  });
  it('raises a tone mark above an upper vowel (ชั้น)', () => {
    expect(cps(fixThaiMarks('ชั้น'))).toEqual(['e0a', 'e31', 'f849', 'e19']);
  });
  it('uses narrow marks over tall consonants (ป้, ปั)', () => {
    expect(cps(fixThaiMarks('ป้'))).toEqual(['e1b', 'f8c9']);
    expect(cps(fixThaiMarks('ปั'))).toEqual(['e1b', 'f8b1']);
  });
  it('uses the nikhahit+tone ligature (น้ำ is sara am, "นํ้า" is typed with nikhahit)', () => {
    expect(cps(fixThaiMarks('นํ้า'))).toEqual(['e19', 'f981', 'e32']);
  });
  it('shortens the tail of ญ ฐ under a lower vowel, ฎ ฏ also lower the vowel', () => {
    expect(cps(fixThaiMarks('ญุ'))).toEqual(['f90d', 'e38']);
    expect(cps(fixThaiMarks('ฎุ'))).toEqual(['f90e', 'f838']);
  });
  it('keeps the other characters of a sentence', () => {
    const t = 'ตารางเรียนประจำชั้น';
    expect(Array.from(fixThaiMarks(t)).length).toBe(Array.from(t).length);
  });
});

import { describe, it, expect } from 'vitest';
import { entryCoversHomeroom } from '../components/scheduleUtils';
import { GradeLevel } from '../types';

const g = (id: string, name: string): GradeLevel => ({ id, name } as GradeLevel);
const grades = [g('m1', 'M.1'), g('m1-1', 'M.1/1'), g('m1-2', 'M.1/2'), g('m2', 'M.2'), g('m2-1', 'M.2/1')];

describe('entryCoversHomeroom (homeroom-changed alert must not fire for level-wide entries)', () => {
  it('entry on the parent level covers a homeroom class of that level', () => {
    expect(entryCoversHomeroom('m1', ['m1-2'], grades)).toBe(true);
  });
  it('entry on the homeroom class itself is fine', () => {
    expect(entryCoversHomeroom('m1-2', ['m1-2'], grades)).toBe(true);
  });
  it('entry on a DIFFERENT class of the same level still counts as a change', () => {
    expect(entryCoversHomeroom('m1-1', ['m1-2'], grades)).toBe(false);
  });
  it('entry on another level does not cover', () => {
    expect(entryCoversHomeroom('m2', ['m1-2'], grades)).toBe(false);
  });
  it('covers when ANY of several homerooms matches; no homeroom → false', () => {
    expect(entryCoversHomeroom('m2', ['m1-2', 'm2-1'], grades)).toBe(true);
    expect(entryCoversHomeroom('m1', undefined, grades)).toBe(false);
    expect(entryCoversHomeroom('m1', [], grades)).toBe(false);
  });
});

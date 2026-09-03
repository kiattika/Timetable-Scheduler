/**
 * Assistant write path — regression tests for "spurious updates for untouched
 * entities". Must use the SAME order-insensitive comparison as the admin path.
 */
import { describe, it, expect } from 'vitest';
import { diffAssistantEntities } from '../../lib/orgChangesClient';
import { normalizeLoadedSubject } from '../../lib/normalizeAppData';

describe('diffAssistantEntities', () => {
  it('adding ONE new subject produces exactly ONE create op and nothing else', () => {
    const before = [
      { id: 't1', name: 'A', department: 'Sci' },
      { id: 't2', name: 'B', department: 'Math' },
    ];
    // reordered keys on the untouched teachers + one genuine new entity
    const after = [
      { department: 'Math', id: 't2', name: 'B' },
      { name: 'A', id: 't1', department: 'Sci' },
      { id: 'new', name: 'ภาษาญี่ปุ่น 1', department: 'ภาษาต่างประเทศ' },
    ];
    const { ops } = diffAssistantEntities(before, after);
    expect(ops).toEqual([{ op: 'create', id: 'new', entity: after[2] }]);
  });

  it('an actual field edit still produces an update op', () => {
    const before = [{ id: 't1', name: 'Old', department: 'Sci' }];
    const after = [{ id: 't1', name: 'New', department: 'Sci' }];
    const { ops } = diffAssistantEntities(before, after);
    expect(ops).toEqual([{ op: 'update', id: 't1', entity: after[0] }]);
  });

  it('a genuine single delete produces a delete op', () => {
    const { ops, skippedDeletes } = diffAssistantEntities([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }]);
    expect(ops).toEqual([{ op: 'delete', id: 'b', entity: { id: 'b' } }]);
    expect(skippedDeletes).toEqual([]);
  });

  it('defensive: "whole array vanished" skips the deletes', () => {
    const before = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const { ops, skippedDeletes } = diffAssistantEntities(before, []);
    expect(ops).toEqual([]);
    expect(skippedDeletes).toEqual(['a', 'b', 'c']);
  });

  it('defensive: an implausible mass-delete is skipped', () => {
    const before = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}` }));
    const after = before.slice(0, 5); // 15 removed at once
    const { ops, skippedDeletes } = diffAssistantEntities(before, after);
    expect(ops).toEqual([]);
    expect(skippedDeletes).toHaveLength(15);
  });

  it('subject key-order drift produces NO ops', () => {
    const before = [{ id: 's1', name: 'Math', subjectCode: 'M1', department: 'Math', teachingMode: 'single' }];
    const after = [{ teachingMode: 'single', department: 'Math', subjectCode: 'M1', name: 'Math', id: 's1' }];
    expect(diffAssistantEntities(before, after).ops).toEqual([]);
  });
});

describe('normalizeLoadedSubject — deterministic, unified across load paths', () => {
  it('always adds the same three keys regardless of input shape', () => {
    const bare = normalizeLoadedSubject({ id: 's1', name: 'X' });
    expect(bare).toMatchObject({ teachingMode: 'single', allowPhysicalRoomSharing: false, allowClassroomSharing: false });

    const student = normalizeLoadedSubject({ id: 's2', name: 'Y', type: 'STUDENT_ONLY' });
    expect(student.allowPhysicalRoomSharing).toBe(true); // migration default for special types

    const already = normalizeLoadedSubject({ id: 's3', name: 'Z', teachingMode: 'multiple', allowClassroomSharing: false });
    expect(already.teachingMode).toBe('multiple');
    expect(already.allowPhysicalRoomSharing).toBe(false);
  });

  it('is idempotent (normalising twice == once)', () => {
    const s = { id: 's1', name: 'X', color: '#fff' };
    expect(normalizeLoadedSubject(normalizeLoadedSubject(s))).toEqual(normalizeLoadedSubject(s));
  });
});

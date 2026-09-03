/**
 * Regression for: `lastSavedDataStr` not reset on logout -> spurious update storm
 * on re-login.
 *
 * App.tsx now nulls the baseline (and the other per-session refs) on any auth
 * transition, and only re-anchors it from a genuine authenticated session. These
 * tests pin the diff behaviour the fix relies on:
 *   - a baseline carried over from a previous session produces a massive spurious
 *     diff against fresh server data (the bug),
 *   - a null baseline (after the reset) produces NO destructive ops — every entity
 *     is at worst an idempotent upsert, never a delete — so the "first load"
 *     anchor is safe.
 */
import { describe, it, expect } from 'vitest';
import { computeOrgChanges, diffAssistantEntities } from '../../lib/orgChangesClient';

// A realistic org snapshot (what the server returns on re-login).
const serverData = {
  teachers: [
    { id: 'uuid-a', name: 'ครูนุสลา รัฐธรรม', department: 'วิทยาศาสตร์และเทคโนโลยี' },
    { id: 'uuid-b', name: 'ครูสมชาย', department: 'คณิตศาสตร์' },
  ],
  subjects: [
    { id: 'uuid-cz', subjectCode: 'CZ', name: 'Cleaning Zone' },
    { id: 'uuid-m1', subjectCode: 'M1', name: 'คณิตศาสตร์พื้นฐาน' },
  ],
  teacherSubjectAssignments: [{ id: 'uuid-l1', teacherId: 'uuid-a', subjectId: 'uuid-cz', gradeLevelId: 'g1' }],
  gradeLevels: [], physicalRooms: [], departments: [], resourceTypes: [], periodSettings: [], scheduleEntries: [],
  organizationSettings: { name: 'UTD' },
};

describe('session reset — baseline must be dropped on auth change', () => {
  it('a stale baseline from the previous session causes a spurious full re-add', () => {
    // previous session had an EMPTY / different baseline (or the app had not really
    // loaded when it was captured)
    const stalePreviousBaseline = { ...serverData, teachers: [], subjects: [], teacherSubjectAssignments: [] };

    const { changes, hasChanges } = computeOrgChanges(stalePreviousBaseline, serverData);
    expect(hasChanges).toBe(true);
    // every existing entity looks "new" -> exactly the storm the user saw
    expect(changes.teachers.upsert.map((t: any) => t.id).sort()).toEqual(['uuid-a', 'uuid-b']);
    expect(changes.subjects.upsert.map((s: any) => s.id).sort()).toEqual(['uuid-cz', 'uuid-m1']);
  });

  it('after the reset (null baseline) the fresh data produces NO deletes', () => {
    const { changes } = computeOrgChanges(null, serverData);
    for (const f of Object.keys(changes)) {
      if (f === 'organizationSettings') continue;
      expect(changes[f].deleteIds).toEqual([]); // never destructive on first anchor
    }
  });

  it('once the baseline is re-anchored to the server data, the next diff is empty', () => {
    // simulate: reset -> anchor baseline = serverData -> next snapshot = same data
    const { hasChanges } = computeOrgChanges(serverData, JSON.parse(JSON.stringify(serverData)));
    expect(hasChanges).toBe(false);
  });

  it('assistant path: stale baseline storms, re-anchored baseline is quiet', () => {
    const stale = diffAssistantEntities([], serverData.teachers); // baseline had no teachers
    expect(stale.ops.map(o => o.op)).toEqual(['create', 'create']);

    const anchored = diffAssistantEntities(serverData.teachers, JSON.parse(JSON.stringify(serverData.teachers)));
    expect(anchored.ops).toEqual([]);
  });
});

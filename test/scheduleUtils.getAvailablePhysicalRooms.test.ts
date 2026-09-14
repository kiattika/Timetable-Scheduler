/**
 * ScheduleScreen assignment modal — Physical Room dropdown conflict filtering.
 *
 * The Physical Room <select> previously listed every room unconditionally, with
 * no check against what's already booked at the target day+period. This tests
 * the pure filtering function that plugs that gap.
 */
import { describe, it, expect } from 'vitest';
import { getAvailablePhysicalRooms } from '../components/scheduleUtils';
import { PhysicalRoom, ScheduleEntry, DayOfWeek } from '../types';

const room = (id: string, code: string): PhysicalRoom => ({
  id,
  code,
  name: `Room ${code}`,
  type: 'CLASSROOM' as any,
});

const entry = (overrides: Partial<ScheduleEntry>): ScheduleEntry => ({
  id: 'entry-1',
  gradeLevelId: 'grade-1',
  day: DayOfWeek.Monday,
  period: 0,
  subjectId: 'subject-1',
  teacherIds: ['teacher-1'],
  physicalRoomId: 'room-1',
  ...overrides,
});

describe('getAvailablePhysicalRooms', () => {
  it('excludes a room already booked by another entry at the exact same day+period', () => {
    const rooms = [room('room-1', '101'), room('room-2', '102')];
    const entries = [entry({ id: 'e1', day: DayOfWeek.Monday, period: 0, physicalRoomId: 'room-1' })];

    const result = getAvailablePhysicalRooms(rooms, entries, DayOfWeek.Monday, 0, null);

    expect(result.map(r => r.id)).toEqual(['room-2']);
  });

  it('includes a room booked at a different day or period', () => {
    const rooms = [room('room-1', '101'), room('room-2', '102')];
    const entries = [
      entry({ id: 'e1', day: DayOfWeek.Tuesday, period: 0, physicalRoomId: 'room-1' }),
      entry({ id: 'e2', day: DayOfWeek.Monday, period: 1, physicalRoomId: 'room-2' }),
    ];

    const result = getAvailablePhysicalRooms(rooms, entries, DayOfWeek.Monday, 0, null);

    expect(result.map(r => r.id).sort()).toEqual(['room-1', 'room-2']);
  });

  it('does not exclude the room currently held by the entry being edited', () => {
    const rooms = [room('room-1', '101'), room('room-2', '102')];
    const entries = [entry({ id: 'editing-entry', day: DayOfWeek.Monday, period: 0, physicalRoomId: 'room-1' })];

    const result = getAvailablePhysicalRooms(rooms, entries, DayOfWeek.Monday, 0, 'editing-entry');

    expect(result.map(r => r.id).sort()).toEqual(['room-1', 'room-2']);
  });

  it('still excludes a room booked by a different entry even while editing another entry', () => {
    const rooms = [room('room-1', '101'), room('room-2', '102')];
    const entries = [
      entry({ id: 'editing-entry', day: DayOfWeek.Monday, period: 0, physicalRoomId: 'room-1' }),
      entry({ id: 'other-entry', day: DayOfWeek.Monday, period: 0, physicalRoomId: 'room-2' }),
    ];

    const result = getAvailablePhysicalRooms(rooms, entries, DayOfWeek.Monday, 0, 'editing-entry');

    expect(result.map(r => r.id)).toEqual(['room-1']);
  });

  it('returns an empty list when every room is booked at that slot', () => {
    const rooms = [room('room-1', '101')];
    const entries = [entry({ id: 'e1', day: DayOfWeek.Monday, period: 0, physicalRoomId: 'room-1' })];

    const result = getAvailablePhysicalRooms(rooms, entries, DayOfWeek.Monday, 0, null);

    expect(result).toEqual([]);
  });
});

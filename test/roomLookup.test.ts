import { describe, it, expect } from 'vitest';
import { findRoomForImport } from '../utils/roomLookup';
import { formatRoomDisplay } from '../utils/stringUtils';

const rooms = [
  { id: 'r1', code: '522', name: 'HR 1/1' },
  { id: 'r2', code: '945', name: 'HR 6/9 (ICT)' },
  { id: 'r3', code: 'F1', name: 'สนามหน้าเสาธง' },
  { id: 'r4', code: '931', name: 'ห้องปฏิบัติการคอมพิวเตอร์ 1' },
];

describe('findRoomForImport', () => {
  it('reads back exactly what the Export writes ("[code] name")', () => {
    rooms.forEach(r => expect(findRoomForImport(rooms, formatRoomDisplay(r))?.id).toBe(r.id));
  });

  it('is case-insensitive and tolerates spacing', () => {
    expect(findRoomForImport(rooms, '[522] hr 1/1')?.id).toBe('r1');
    expect(findRoomForImport(rooms, '  [f1]   สนามหน้าเสาธง ')?.id).toBe('r3');
  });

  it('prefers the room code in brackets over the name', () => {
    // name text is stale/mismatched but the code identifies the room
    expect(findRoomForImport(rooms, '[522] ชื่อเก่า')?.id).toBe('r1');
  });

  it('falls back to the name when the bracketed code is unknown', () => {
    expect(findRoomForImport(rooms, '[999] HR 1/1')?.id).toBe('r1');
  });

  it('still supports plain code, "ห้อง code" and plain name', () => {
    expect(findRoomForImport(rooms, '931')?.id).toBe('r4');
    expect(findRoomForImport(rooms, 'ห้อง 931')?.id).toBe('r4');
    expect(findRoomForImport(rooms, 'HR 6/9 (ICT)')?.id).toBe('r2');
  });

  it('returns undefined for unknown or empty input', () => {
    expect(findRoomForImport(rooms, '[000] ไม่มีห้องนี้')).toBeUndefined();
    expect(findRoomForImport(rooms, '')).toBeUndefined();
    expect(findRoomForImport(undefined, '522')).toBeUndefined();
  });
});

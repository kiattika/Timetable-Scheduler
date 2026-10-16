import { describe, it, expect } from 'vitest';
import {
  normalizeBuildingId, parseRoomCode, roomBuilding, roomFloor, gridToStored, gridFromStored, parseGridText,
  buildingPositions, buildingDistance, suggestRoomLocations, locationCoverage, squareGrid,
} from '../utils/buildings';

const room = (id: string, code: string, extra: any = {}) => ({ id, code, name: `ห้อง ${code}`, type: 'x', ...extra });

describe('room code', () => {
  it('decodes 3-digit codes: 931 = building 9, floor 3, room 1', () => {
    expect(parseRoomCode('931')).toEqual({ building: '9', floor: 3, room: '1' });
    expect(parseRoomCode(' 941 ')).toEqual({ building: '9', floor: 4, room: '1' });
  });
  it('decodes F (field) and P (playground) codes', () => {
    expect(parseRoomCode('F001')).toMatchObject({ building: 'F1' });
    expect(parseRoomCode('f003')).toMatchObject({ building: 'F3' });
    expect(parseRoomCode('P900')).toMatchObject({ building: 'P9' });
    expect(parseRoomCode('P901')).toMatchObject({ building: 'P9', room: '01' });
  });
  it('does not guess ambiguous or unknown codes', () => {
    expect(parseRoomCode('1031')).toBeNull();
    expect(parseRoomCode('F000')).toBeNull();
    expect(parseRoomCode('G001')).toBeNull();
    expect(parseRoomCode('P1000')).toBeNull();
    expect(parseRoomCode('')).toBeNull();
    expect(parseRoomCode(undefined)).toBeNull();
  });
  it('explicit building/floor beat the code', () => {
    expect(roomBuilding(room('a', '931'))).toBe('9');
    expect(roomBuilding(room('a', '931', { building: 'อาคาร 10' }))).toBe('10');
    expect(roomBuilding(room('a', 'F001'))).toBe('F1');
    expect(roomBuilding(room('a', 'G001'))).toBeNull();
    expect(roomFloor(room('a', '931'))).toBe(3);
    expect(roomFloor(room('a', '931', { floor: 5 }))).toBe(5);
    expect(roomFloor(room('a', '931', { floor: '' }))).toBe(3);
  });
  it('normalizes building ids', () => {
    expect(normalizeBuildingId('อาคาร 9')).toBe('9');
    expect(normalizeBuildingId(' 10 ')).toBe('10');
    expect(normalizeBuildingId(null)).toBe('');
  });
});

describe("the school's layout (left column only 6,7,8)", () => {
  const text = '8,4,\n7,3,\n6,2,5\n,1,\n,9,';
  const grid = parseGridText(text);
  const { positions, duplicates } = buildingPositions(grid);
  it('parses the pasted/typed grid', () => {
    expect(grid).toEqual([['8', '4', ''], ['7', '3', ''], ['6', '2', '5'], ['', '1', ''], ['', '9', '']]);
    expect(duplicates).toEqual([]);
    expect(positions.get('6')).toEqual([{ row: 2, col: 0 }]);
    expect(positions.get('5')).toEqual([{ row: 2, col: 2 }]);
  });
  it('tab separated (Excel / Google Sheets copy) gives the same grid', () => {
    expect(parseGridText('8\t4\t\n7\t3\t\n6\t2\t5\n\t1\t\n\t9\t')).toEqual(grid);
  });
  it('distance in cells', () => {
    expect(buildingDistance('2', '1', positions)).toBe(1);
    expect(buildingDistance('6', '5', positions)).toBe(2); // across building 2
    expect(buildingDistance('8', '9', positions)).toBe(4.12);
    expect(buildingDistance('9', '9', positions)).toBe(0);
    expect(buildingDistance('9', '77', positions)).toBeNull();
  });
  it('a field may span several cells; distance uses the closest cells', () => {
    const g = parseGridText('F1,F1,\n,2,1');
    const { positions: p, duplicates: d } = buildingPositions(g);
    expect(d).toEqual([]);
    expect(buildingDistance('F1', '1', p)).toBe(1.41);
    expect(buildingDistance('F1', '2', p)).toBe(1);
  });
  it('plain letter cell F / P stands for all fields / playgrounds', () => {
    const { positions: p } = buildingPositions(parseGridText('F,F,\nF,9,\n,P,'));
    expect(buildingDistance('F3', '9', p)).toBe(1);
    expect(buildingDistance('P9', '9', p)).toBe(1);
    expect(buildingDistance('P9', 'F2', p)).toBe(1.41);
    const only9 = buildingPositions(parseGridText('9'));
    expect(buildingDistance('P9', '9', only9.positions)).toBe(0);
  });
  it('detects a building placed twice', () => {
    expect(buildingPositions([['1', '2'], ['2', '']]).duplicates).toEqual(['2']);
  });
  it('round-trips through the Firestore-safe stored shape (no nested arrays)', () => {
    const stored = gridToStored(grid);
    expect(Array.isArray(stored[0])).toBe(false);
    expect(gridFromStored(stored)).toEqual(grid);
    expect(gridFromStored(undefined)).toEqual([]);
  });
  it('drops empty trailing rows/columns', () => {
    expect(squareGrid([['1', '', ''], ['', '', ''], ['', '', '']])).toEqual([['1']]);
  });
});

describe('preparation checklist', () => {
  const rooms: any[] = [room('1', '931'), room('2', '941'), room('3', 'G001'), room('4', '1031'), room('5', '931', { building: '3' }), room('6', '705')];
  it('suggests only decodable rooms without an explicit building', () => {
    expect(suggestRoomLocations(rooms).map((s) => s.id)).toEqual(['1', '2', '6']);
  });
  it('coverage lists what still needs hand entry and what is missing from the grid', () => {
    const cov = locationCoverage(rooms, parseGridText('9,3'));
    expect(cov.total).toBe(6);
    expect(cov.unresolved.map((u) => u.id)).toEqual(['3', '4']);
    expect(cov.withBuilding).toBe(4);
    expect(cov.buildingsNotOnGrid).toEqual(['7']);
    expect(locationCoverage([room('x','F002'), room('y','P900')] as any, parseGridText('F,9')).buildingsNotOnGrid).toEqual([]);
  });
});

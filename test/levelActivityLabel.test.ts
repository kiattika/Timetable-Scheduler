import { describe, it, expect } from 'vitest';
import { levelActivityLabel } from '../components/scheduleUtils';

describe('levelActivityLabel', () => {
  it('scouts get ผู้กำกับลูกเสือ + level', () => {
    expect(levelActivityLabel({ name: 'ลูกเสือ/เนตรนารี', isBroadAssignment: true }, 'M.1'))
      .toEqual({ leader: 'ผู้กำกับลูกเสือ ม.1', activity: 'ลูกเสือ/เนตรนารี' });
  });
  it('uses the level part of a class name', () => {
    expect(levelActivityLabel({ name: 'ลูกเสือ/เนตรนารี', isBroadAssignment: true }, 'M.2/3')?.leader).toBe('ผู้กำกับลูกเสือ ม.2');
  });
  it('military students get ผู้กำกับ นศท.', () => {
    expect(levelActivityLabel({ name: 'กิจกรรมชุมนุม/นศท', isBroadAssignment: true }, 'M.4')?.leader).toBe('ผู้กำกับ นศท. ม.4');
    expect(levelActivityLabel({ name: 'นักศึกษาวิชาทหาร', isBroadAssignment: true }, 'M.5')?.leader).toBe('ผู้กำกับ นศท. ม.5');
  });
  it('other or non-broad subjects print the normal teacher names', () => {
    expect(levelActivityLabel({ name: 'กิจกรรมแนะแนว', isBroadAssignment: true }, 'M.1')).toBeNull();
    expect(levelActivityLabel({ name: 'ลูกเสือ/เนตรนารี', isBroadAssignment: false }, 'M.1')).toBeNull();
    expect(levelActivityLabel(undefined, 'M.1')).toBeNull();
  });
});

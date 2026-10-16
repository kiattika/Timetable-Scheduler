import React from 'react';
import { WalkMark } from '../types';

/** Small corner marker for the walking check. Colour plus a title with the reason; never printed. */
export const WalkDot: React.FC<{ mark?: WalkMark | null }> = ({ mark }) => {
  if (!mark) return null;
  const eff = mark.accepted ? 'ok' : mark.severity;
  const icon = eff === 'risk' ? '🔴' : eff === 'watch' ? '🟡' : '🟢';
  const label = eff === 'risk' ? 'เสี่ยง' : eff === 'watch' ? 'ควรดู' : 'ผู้สอนรับได้';
  return (
    <span
      className="non-printable absolute top-0.5 right-0.5 z-10 text-[11px] leading-none cursor-help select-none"
      title={`ตรวจการเดิน: ${label}\n${mark.text}${mark.accepted ? '\n(ผู้สอนรับได้แล้ว)' : ''}`}
      aria-label={`ตรวจการเดิน ${label}`}
    >
      {icon}{mark.accepted ? '✓' : ''}
    </span>
  );
};

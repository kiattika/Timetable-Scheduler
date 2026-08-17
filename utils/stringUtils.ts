export const truncateString = (str: string | undefined | null, maxLength: number): string => {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + "...";
};

export const formatRoomDisplay = (room: any | undefined | null): string => {
  if (!room) return '-';
  const code = room.code || room.number; // handle potential variations
  const name = room.name || '-';
  if (code) return `[${code}] ${name}`;
  return name;
};

export const formatRoomShort = (room: any | undefined | null): string => {
  if (!room) return '';
  const code = room.code || room.number;
  const name = room.name || '';
  return code ? String(code) : String(name);
};

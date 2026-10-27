/**
 * Resolve the text in a "Homeroom" cell of an imported Excel/CSV file to a physical room.
 *
 * Accepted forms (case-insensitive):
 *   - "[522] HR 1/1"  — the format the Export writes (formatRoomDisplay); the room code is the unique key, so it wins
 *   - "522"           — room code
 *   - "ห้อง 522"      — "room " + code
 *   - "HR 1/1"        — room name
 */
export const findRoomForImport = <R extends { id: string; code?: string; name?: string }>(
  rooms: R[] | undefined | null,
  text: unknown
): R | undefined => {
  const lc = (v: unknown) => String(v ?? '').toLowerCase().trim();
  const raw = String(text ?? '').trim();
  if (!raw) return undefined;
  const list = rooms || [];
  const query = raw.toLowerCase();

  const bracket = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
  const bracketCode = bracket ? lc(bracket[1]) : '';
  const bracketName = bracket ? lc(bracket[2]) : '';

  return (
    (bracketCode ? list.find(r => lc(r.code) === bracketCode) : undefined) ||
    (bracketName ? list.find(r => lc(r.name) === bracketName) : undefined) ||
    list.find(r => lc(r.name) === query || lc(r.code) === query || `ห้อง ${lc(r.code)}` === query)
  );
};

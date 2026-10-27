/**
 * Undo, in the local list, writes the server permanently rejected.
 *
 * The assistant's UI applies a slot locally first and syncs it ~2s later. When the
 * server rejects it for good (e.g. permission-denied), the local card would stay on
 * screen — a "ghost" the server never stored — until the page is refreshed. Reverting
 * to the last known server state removes it right away.
 */

export type FailedAssistantOp = {
  key: string;                          // entity list, e.g. 'scheduleEntries'
  op: 'create' | 'update' | 'delete';
  id: string;
  prior?: any;                          // the entity as last persisted (undefined for a create)
};

export const revertFailedOps = <T extends { id: string }>(
  list: T[] | undefined,
  failed: FailedAssistantOp[],
  key: string,
): T[] => {
  const out: T[] = [...(list || [])];
  for (const f of failed) {
    if (f.key !== key) continue;
    const i = out.findIndex((e) => e && e.id === f.id);
    if (f.op === 'create') {
      if (i >= 0) out.splice(i, 1);                       // never reached the server -> drop it
    } else if (f.prior) {
      if (i >= 0) out[i] = f.prior as T;                  // update/delete rejected -> back to the persisted version
      else out.push(f.prior as T);
    } else if (i >= 0) {
      out.splice(i, 1);                                   // no persisted version known -> nothing to restore
    }
  }
  return out;
};

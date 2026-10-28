// A page that sends back files it kept from an earlier submit names the
// account that first sent them, or 'none' when that visitor was signed out.
// Older pages send nothing, and their uploads are taken as before.
export const KEPT_OWNER_FIELD = 'kept-owner';
const SIGNED_OUT = 'none';

export function keptFilesChangedOwner(body: unknown, owner: unknown): boolean {
  if (body == null || typeof body !== 'object') return false;
  const sentBy = (body as Record<string, unknown>)[KEPT_OWNER_FIELD];
  if (sentBy === undefined) return false;
  const session = owner == null || owner === '' ? SIGNED_OUT : String(owner);
  return sentBy !== session;
}

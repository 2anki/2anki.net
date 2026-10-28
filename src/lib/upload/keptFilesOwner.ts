// A page that sends back files it kept from an earlier submit names the
// account that first sent them, or 'none' when that visitor was signed out.
// Older pages send nothing, and their uploads are taken as before.
export const KEPT_OWNER_FIELD = 'kept-owner';

// Every answer to an upload names the session it ran under, so the page knows
// whose files it is keeping without reading the account again later.
export const UPLOAD_OWNER_HEADER = 'X-Upload-Owner';

const SIGNED_OUT = 'none';

export function sessionOwnerOf(owner: unknown): string {
  return owner == null || owner === '' ? SIGNED_OUT : String(owner);
}

// The field only checks the request; taken off here, it never reaches the
// card options or the settings a background job saves.
export function takeKeptOwner(body: unknown): unknown {
  if (body == null || typeof body !== 'object') return undefined;
  const fields = body as Record<string, unknown>;
  const sentBy = fields[KEPT_OWNER_FIELD];
  delete fields[KEPT_OWNER_FIELD];
  return sentBy;
}

export function keptFilesChangedOwner(
  sentBy: unknown,
  owner: unknown
): boolean {
  return sentBy !== undefined && sentBy !== sessionOwnerOf(owner);
}

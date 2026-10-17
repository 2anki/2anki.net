import type { EmptyUploadReading } from '@server/types/EmptyUploadReading';

export type { EmptyUploadReading };

const DOCUMENT_FIELDS = [
  'words',
  'headings',
  'listItems',
  'tables',
  'toggles',
  'images',
] as const;
const ZIP_FIELDS = [
  'files',
  'readable',
  'archives',
  'imageFiles',
  'otherFiles',
] as const;

function hasCounts(
  value: Record<string, unknown>,
  fields: readonly string[]
): boolean {
  return fields.every((field) => {
    const count = value[field];
    return typeof count === 'number' && Number.isInteger(count) && count >= 0;
  });
}

// Mirrors the server guard: the 400 body is data from the network, so the
// shape is checked before the form renders counts from it.
export function isEmptyUploadReading(
  value: unknown
): value is EmptyUploadReading {
  if (value == null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.kind === 'document') return hasCounts(record, DOCUMENT_FIELDS);
  if (record.kind === 'zip') return hasCounts(record, ZIP_FIELDS);
  return false;
}

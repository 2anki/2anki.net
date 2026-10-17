// What the parser saw in an upload that produced no cards. Counts only, never
// filenames or text: the shape is shown back to the user so they know what to
// change, and it rides the 400 body, so it must carry nothing identifying.
export interface DocumentReading {
  kind: 'document';
  words: number;
  headings: number;
  listItems: number;
  tables: number;
  toggles: number;
  images: number;
}

export interface ZipReading {
  kind: 'zip';
  files: number;
  readable: number;
  imageFiles: number;
  otherFiles: number;
}

export type EmptyUploadReading = DocumentReading | ZipReading;

const DOCUMENT_FIELDS = [
  'words',
  'headings',
  'listItems',
  'tables',
  'toggles',
  'images',
] as const;
const ZIP_FIELDS = ['files', 'readable', 'imageFiles', 'otherFiles'] as const;

function hasCounts(
  value: Record<string, unknown>,
  fields: readonly string[]
): boolean {
  return fields.every(
    (field) =>
      typeof value[field] === 'number' &&
      Number.isInteger(value[field]) &&
      (value[field] as number) >= 0
  );
}

export function isEmptyUploadReading(
  value: unknown
): value is EmptyUploadReading {
  if (value == null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.kind === 'document') return hasCounts(record, DOCUMENT_FIELDS);
  if (record.kind === 'zip') return hasCounts(record, ZIP_FIELDS);
  return false;
}

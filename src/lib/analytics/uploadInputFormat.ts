// The extension of the first uploaded file, lowercased. A shape metric, never
// the filename itself — see .claude/rules/support-confidentiality.md.
//
// Allowlisted rather than passed through: the value is a cohort key, and an
// unbounded one lets any upload mint a cohort of size one. Anything unrecognised
// buckets into 'other' so the cardinality stays fixed.
const KNOWN_INPUT_FORMATS = new Set([
  'zip',
  'html',
  'htm',
  'md',
  'markdown',
  'csv',
  'tsv',
  'xlsx',
  'xls',
  'pdf',
  'docx',
  'doc',
  'pptx',
  'ppt',
  'txt',
  'apkg',
  'opml',
  'epub',
  'xml',
  'json',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
]);

interface NamedFile {
  originalname?: string;
}

export function uploadInputFormat(files: NamedFile[] | undefined): string {
  const name = files?.[0]?.originalname;
  if (typeof name !== 'string') return 'unknown';
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return 'unknown';
  const ext = name.slice(dot + 1).toLowerCase();
  return KNOWN_INPUT_FORMATS.has(ext) ? ext : 'other';
}

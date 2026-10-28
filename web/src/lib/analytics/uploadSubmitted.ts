// The server's upload_started fires only once the whole file has arrived, so a
// transfer that dies on the way never counts there. This client-side event
// fires each time the upload form sends a file, so the gap between the two
// (server side filtered to web uploads) is mostly transfers that never
// arrived; it also holds the few sends the browser could not read and the
// requests the server refused before upload_started. Shape only, never the
// filename: the type is allowlisted (the same set as the server's
// uploadInputFormat, and the same prop name) and the size is bucketed.
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
  'dotx',
  'rtf',
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

const MB = 1024 * 1024;

// Why the form sent the file: a first submit or a file handed over from
// another page is new; a resume after reload, Try again and a resend with a
// changed choice send a file that went out before.
export type UploadTrigger =
  | 'submit'
  | 'handoff'
  | 'resume'
  | 'retry'
  | 'resend';

const SENT_BEFORE: ReadonlySet<UploadTrigger> = new Set([
  'resume',
  'retry',
  'resend',
]);

export type UploadSubmittedProps = {
  input_format: string;
  size_bucket: string;
  file_count: number;
  trigger: UploadTrigger;
  retry: boolean;
};

function inputFormat(files: readonly File[]): string {
  const name = files[0]?.name;
  if (name == null) return 'unknown';
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return 'unknown';
  const ext = name.slice(dot + 1).toLowerCase();
  return KNOWN_INPUT_FORMATS.has(ext) ? ext : 'other';
}

function sizeBucket(bytes: number): string {
  if (bytes < MB) return '<1MB';
  if (bytes < 5 * MB) return '1-5MB';
  if (bytes < 25 * MB) return '5-25MB';
  if (bytes < 100 * MB) return '25-100MB';
  return '>=100MB';
}

export function uploadSubmittedProps(
  files: readonly File[],
  trigger: UploadTrigger
): UploadSubmittedProps {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return {
    input_format: inputFormat(files),
    size_bucket: sizeBucket(totalBytes),
    file_count: files.length,
    trigger,
    retry: SENT_BEFORE.has(trigger),
  };
}

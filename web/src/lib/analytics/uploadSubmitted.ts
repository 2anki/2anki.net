// The server's upload_started only fires once the whole file has arrived, so a
// transfer that dies on the way never counts. This client-side event fires
// when the person sends the file; the gap between the two is the failed
// transfers. Shape only, never the filename: the type is allowlisted (the same
// set as the server's uploadInputFormat) and the size is bucketed, so neither
// can identify an upload.
const KNOWN_FILE_TYPES = new Set([
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

export type UploadSubmittedProps = {
  fileExt: string;
  sizeBucket: string;
  fileCount: number;
  retry: boolean;
};

function fileType(files: readonly File[]): string {
  const name = files[0]?.name;
  if (name == null) return 'unknown';
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return 'unknown';
  const ext = name.slice(dot + 1).toLowerCase();
  return KNOWN_FILE_TYPES.has(ext) ? ext : 'other';
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
  retry: boolean
): UploadSubmittedProps {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return {
    fileExt: fileType(files),
    sizeBucket: sizeBucket(totalBytes),
    fileCount: files.length,
    retry,
  };
}

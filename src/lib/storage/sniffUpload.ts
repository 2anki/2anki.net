const ALIASES = new Map([
  ['text', 'txt'],
  ['markdown', 'md'],
  ['mdown', 'md'],
]);

// Extensions the pipeline already routes, plus shortcut and icon files that
// are text or binary by accident and must keep their own answer.
const KNOWN_EXTENSIONS = new Set([
  'md',
  'html',
  'htm',
  'txt',
  'csv',
  'tsv',
  'doc',
  'docx',
  'dotx',
  'docm',
  'dotm',
  'rtf',
  'pdf',
  'ppt',
  'pptx',
  'xlsx',
  'opml',
  'json',
  'epub',
  'xml',
  'zip',
  'apkg',
  'colpkg',
  'anki2',
  'anki21',
  'anki21b',
  'pages',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'svg',
  'webp',
  'heic',
  'heif',
  'tiff',
  'ico',
  'lnk',
  'url',
  'webloc',
  'desktop',
  'goodnotes',
]);

const SNIFF_BYTES = 64 * 1024;
const PDF_MAGIC = Buffer.from('%PDF');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const RTF_MAGIC = Buffer.from('{\\rtf');
const NUL = 0;

function extensionOf(name: string): string | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  return match == null ? null : match[1].toLowerCase();
}

// A zip lists its entry names in the central directory at the end.
const ZIP_DIRECTORY_BYTES = 4 * 1024 * 1024;

function zipKind(contents: Buffer): string {
  const directory = contents.subarray(-ZIP_DIRECTORY_BYTES);
  if (directory.includes('word/document.xml')) return 'docx';
  if (directory.includes('xl/workbook.xml')) return 'xlsx';
  if (directory.includes('ppt/presentation.xml')) return 'pptx';
  return 'zip';
}

const HTML_START = /^\s*(<!doctype html|<html)/i;

function isReadableText(head: Buffer): boolean {
  if (head.includes(NUL)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return true;
  } catch {
    // A multi-byte character cut off at the end of the head is still text.
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(
        head.subarray(0, head.length - 3)
      );
      return true;
    } catch {
      return false;
    }
  }
}

function sniffExtension(contents: Buffer): string | null {
  if (contents.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return 'pdf';
  if (contents.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
    return zipKind(contents);
  }
  if (contents.subarray(0, RTF_MAGIC.length).equals(RTF_MAGIC)) return 'rtf';
  const head = contents.subarray(0, SNIFF_BYTES);
  if (head.length === 0 || !isReadableText(head)) return null;
  return HTML_START.test(head.toString('utf-8')) ? 'html' : 'txt';
}

// The format is picked from the file name, so a browser-renamed copy
// ("notes.zip (1)") or a title with a period in it was read as the wrong
// thing. An unknown extension is replaced by what the first bytes say.
export function nameFromContent(name: string, contents: Buffer): string {
  const extension = extensionOf(name);
  const alias = extension == null ? undefined : ALIASES.get(extension);
  if (extension != null && alias != null) {
    return name.slice(0, name.length - extension.length) + alias;
  }
  if (extension != null && KNOWN_EXTENSIONS.has(extension)) return name;
  const sniffed = sniffExtension(contents);
  return sniffed == null ? name : `${name}.${sniffed}`;
}

export function hasUnknownExtension(name: string): boolean {
  const extension = extensionOf(name);
  return (
    extension == null ||
    !(KNOWN_EXTENSIONS.has(extension) || ALIASES.has(extension))
  );
}

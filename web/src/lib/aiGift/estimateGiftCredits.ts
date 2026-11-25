import { strFromU8, unzipSync, type UnzipFileInfo } from 'fflate';
import { giftFileKind } from './giftFileKinds';

// No conversion has a cost check before it runs, so the convert step reads
// the text Claude would get. Claude reads HTML in 40,000-character chunks
// with styles and scripts removed; one chunk is about 10,000 input tokens and
// a few thousand output tokens at Sonnet prices, roughly 12 credits (a credit
// is one US cent).
export const CREDITS_PER_TEXT_CHARACTER = 12 / 40_000;
export const MIN_ESTIMATE_CREDITS = 5;

// Reading is bounded: a zip is read only up to this size, and the text it
// would unpack only up to this many bytes, as its own directory declares
// them. Past either bound there is no honest number, so none is shown.
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const MAX_TEXT_BYTES = 20 * 1024 * 1024;

// The smallest a zip directory entry can be. A zip that declares more
// entries than its bytes could hold is not read.
const ZIP_ENTRY_MIN_BYTES = 46;

class NoHonestNumber extends Error {}

const TEXT_ENTRY = /\.(html?|md|markdown|txt|csv|tsv)$/i;
const NESTED_ZIP = /\.zip$/i;
const DOCX_BODY = 'word/document.xml';

export function claudeReadableText(html: string): string {
  return html
    .replaceAll(/<head[\s\S]*?<\/head>/gi, '')
    .replaceAll(/<style[\s\S]*?<\/style>/gi, '')
    .replaceAll(/<script[\s\S]*?<\/script>/gi, '');
}

function docxText(xml: string): string {
  return Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g))
    .map((match) => match[1])
    .join(' ');
}

function unzipEntries(
  bytes: Uint8Array,
  wanted: (name: string) => boolean
): Record<string, Uint8Array> {
  let entries = 0;
  let declared = 0;
  const limit = Math.floor(bytes.length / ZIP_ENTRY_MIN_BYTES);
  try {
    return unzipSync(bytes, {
      filter: (file: UnzipFileInfo) => {
        entries += 1;
        if (entries > limit) throw new NoHonestNumber();
        if (!wanted(file.name)) return false;
        declared += file.originalSize;
        if (declared > MAX_TEXT_BYTES) throw new NoHonestNumber();
        return true;
      },
    });
  } catch {
    throw new NoHonestNumber();
  }
}

function zipTextLength(bytes: Uint8Array, depth: number): number {
  const entries = unzipEntries(
    bytes,
    (name) => TEXT_ENTRY.test(name) || (depth === 0 && NESTED_ZIP.test(name))
  );
  let length = 0;
  for (const [name, data] of Object.entries(entries)) {
    length += NESTED_ZIP.test(name)
      ? zipTextLength(data, depth + 1)
      : claudeReadableText(strFromU8(data)).length;
  }
  return length;
}

async function fileBytes(file: Blob, cap: number): Promise<Uint8Array> {
  if (file.size > cap) throw new NoHonestNumber();
  return new Uint8Array(await file.arrayBuffer());
}

// The text Claude would read from one file, or no number: PDFs and slides
// (read page by page, scanned ones as images) and anything past the bounds.
async function textLength(file: File): Promise<number> {
  const kind = giftFileKind(file.name);
  if (kind === 'text' || kind === 'html') {
    const text = strFromU8(await fileBytes(file, MAX_TEXT_BYTES));
    return kind === 'html' ? claudeReadableText(text).length : text.length;
  }
  if (kind === 'zip') {
    return zipTextLength(await fileBytes(file, MAX_ZIP_BYTES), 0);
  }
  if (kind === 'office' && /\.docx$/i.test(file.name)) {
    const entries = unzipEntries(
      await fileBytes(file, MAX_ZIP_BYTES),
      (name) => name === DOCX_BODY
    );
    const body = entries[DOCX_BODY];
    if (body == null) throw new NoHonestNumber();
    return docxText(strFromU8(body)).length;
  }
  throw new NoHonestNumber();
}

export function creditsForText(length: number): number {
  const raw = length * CREDITS_PER_TEXT_CHARACTER;
  return Math.max(MIN_ESTIMATE_CREDITS, Math.ceil(raw / 5) * 5);
}

// An "about" figure from the text Claude would read, rounded up to 5, or
// null when there is no honest number to show.
export async function estimateGiftCredits(
  files: readonly File[]
): Promise<number | null> {
  try {
    let length = 0;
    for (const file of files) {
      length += await textLength(file);
    }
    return creditsForText(length);
  } catch {
    return null;
  }
}

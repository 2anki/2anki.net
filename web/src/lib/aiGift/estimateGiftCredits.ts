import { strFromU8, unzipSync, type UnzipFileInfo } from 'fflate';
import { giftFileKind } from './giftFileKinds';

// No conversion has a cost check before it runs, so the convert step reads
// the text Claude would get. Claude reads HTML in 40,000-character chunks
// with styles and scripts removed; one chunk is about 10,000 input tokens and
// a few thousand output tokens at Sonnet prices, roughly 12 credits (a credit
// is one US cent).
export const CREDITS_PER_TEXT_CHARACTER = 12 / 40_000;
export const MIN_ESTIMATE_CREDITS = 5;

// Reading is bounded for the whole estimate, every file and nested zip
// together: each zip is read only up to MAX_ZIP_BYTES, the text read or
// unpacked only up to MAX_TEXT_BYTES in total, and the work only up to
// MAX_ESTIMATE_MS. Past any bound there is no honest number, so none is shown.
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const MAX_TEXT_BYTES = 20 * 1024 * 1024;
export const MAX_ESTIMATE_MS = 2_000;

interface Budget {
  bytesLeft: number;
  deadline: number;
}

function spend(budget: Budget, bytes: number): void {
  budget.bytesLeft -= bytes;
  if (budget.bytesLeft < 0 || Date.now() > budget.deadline) {
    throw new NoHonestNumber();
  }
}

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

// An entry whose unpacked bytes are not the size its directory declared is
// not what it says it is, so the estimate has no number for it.
function unzipEntries(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
  budget: Budget
): Record<string, Uint8Array> {
  let entries = 0;
  const declared = new Map<string, number>();
  const limit = Math.floor(bytes.length / ZIP_ENTRY_MIN_BYTES);
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(bytes, {
      filter: (file: UnzipFileInfo) => {
        entries += 1;
        if (entries > limit) throw new NoHonestNumber();
        if (!wanted(file.name)) return false;
        spend(budget, file.originalSize);
        declared.set(file.name, file.originalSize);
        return true;
      },
    });
  } catch {
    throw new NoHonestNumber();
  }
  for (const [name, data] of Object.entries(unpacked)) {
    if (data.length !== declared.get(name)) throw new NoHonestNumber();
  }
  return unpacked;
}

function zipTextLength(
  bytes: Uint8Array,
  depth: number,
  budget: Budget
): number {
  const entries = unzipEntries(
    bytes,
    (name) => TEXT_ENTRY.test(name) || (depth === 0 && NESTED_ZIP.test(name)),
    budget
  );
  let length = 0;
  for (const [name, data] of Object.entries(entries)) {
    length += NESTED_ZIP.test(name)
      ? zipTextLength(data, depth + 1, budget)
      : claudeReadableText(strFromU8(data)).length;
    spend(budget, 0);
  }
  return length;
}

async function fileBytes(file: Blob, cap: number): Promise<Uint8Array> {
  if (file.size > cap) throw new NoHonestNumber();
  return new Uint8Array(await file.arrayBuffer());
}

// The text Claude would read from one file, or no number: PDFs and slides
// (read page by page, scanned ones as images) and anything past the bounds.
async function textLength(file: File, budget: Budget): Promise<number> {
  const kind = giftFileKind(file.name);
  if (kind === 'text' || kind === 'html') {
    spend(budget, file.size);
    const text = strFromU8(await fileBytes(file, MAX_TEXT_BYTES));
    return kind === 'html' ? claudeReadableText(text).length : text.length;
  }
  if (kind === 'zip') {
    return zipTextLength(await fileBytes(file, MAX_ZIP_BYTES), 0, budget);
  }
  if (kind === 'office' && /\.docx$/i.test(file.name)) {
    const entries = unzipEntries(
      await fileBytes(file, MAX_ZIP_BYTES),
      (name) => name === DOCX_BODY,
      budget
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
  const budget: Budget = {
    bytesLeft: MAX_TEXT_BYTES,
    deadline: Date.now() + MAX_ESTIMATE_MS,
  };
  try {
    let length = 0;
    for (const file of files) {
      length += await textLength(file, budget);
    }
    return creditsForText(length);
  } catch {
    return null;
  }
}

import { lastZipEntryNamed } from '../../../lib/zip/walkZipDirectory';

// mammoth builds the whole Word body in memory several times over, about 40
// bytes of heap per byte of word/document.xml, so a long body runs the 1 GB
// conversion child out of heap after ten seconds or so. Largest body XML that
// converted and smallest that crashed, measured on the whole upload path
// under that 1 GB limit with synthetic documents (2026-11-25):
//   lecture notes with figures      26.9 MB / 27.5 MB
//   bulleted notes with figures     26.5 MB / 27.1 MB
//   markup-heavy Word paragraphs    31.4 MB / 32.2 MB
//   plain paragraphs and tables     33.1 MB / 33.6 MB
//   the lecture notes indented      28.9 MB / 34.6 MB
//   runs of empty paragraphs        crash from 20 MB
// Nothing shaped like Word output converted above 33.1 MB, so a body
// declared above this threshold is refused before the converter starts; the
// margin covers a shape a little more compact than plain text. A body padded
// with XML comments or long runs of whitespace converts far larger (160 MB
// measured), but Word does not write either, and no threshold could cover it.
export const MAX_CONVERTIBLE_WORD_BODY_BYTES = 36_000_000;

const MAIN_DOCUMENT_PART = 'word/document.xml';
const UNKNOWN_32_BIT_SIZE = 0xffffffff;
const WORD_DOCUMENT_TOO_LONG = 'WordDocumentTooLongError';

export class WordDocumentTooLongError extends Error {
  readonly declaredBodyBytes: number;

  constructor(declaredBodyBytes: number) {
    super(`word_document_too_long: ${declaredBodyBytes} bytes of body XML`);
    this.name = WORD_DOCUMENT_TOO_LONG;
    this.declaredBodyBytes = declaredBodyBytes;
  }
}

// The worker serialises errors down to { message, name }, so the parent
// matches the refusal by name. jobFailureReason and UploadService give the
// visitor the same message as a conversion that ran out of heap, under a
// reason of its own.
export function isWordDocumentTooLongError(err: unknown): err is Error {
  return err instanceof Error && err.name === WORD_DOCUMENT_TOO_LONG;
}

// The uncompressed size the zip directory declares for the Word body the
// converter reads (the last entry of that name, as its zip reader takes),
// read without inflating anything. Null when the directory cannot be read or
// the size is missing or unknown (0 or 0xFFFFFFFF), in which
// case the file converts as before.
export function declaredWordBodyBytes(contents: Buffer): number | null {
  const entry = lastZipEntryNamed(contents, MAIN_DOCUMENT_PART);
  if (entry == null || entry === 'unreadable') return null;
  const known =
    entry.originalSize > 0 && entry.originalSize !== UNKNOWN_32_BIT_SIZE;
  return known ? entry.originalSize : null;
}

export function refuseWordDocumentTooLong(contents: Buffer): void {
  const declared = declaredWordBodyBytes(contents);
  if (declared == null || declared <= MAX_CONVERTIBLE_WORD_BODY_BYTES) return;
  console.info('[PrepareDeck] Word body too long to convert, refused', {
    declaredBodyBytes: declared,
    thresholdBytes: MAX_CONVERTIBLE_WORD_BODY_BYTES,
  });
  throw new WordDocumentTooLongError(declared);
}

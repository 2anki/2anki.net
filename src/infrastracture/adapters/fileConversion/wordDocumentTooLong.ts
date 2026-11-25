import { unzipSync } from 'fflate';

// mammoth builds the whole Word body in memory several times over, about 40
// bytes of heap per byte of word/document.xml, so a long body runs the 1 GB
// conversion child out of heap after ten seconds or so. Largest body XML that
// converted and smallest that crashed, measured on the whole upload path
// under that 1 GB limit with synthetic documents (2026-11-25):
//   lecture notes with figures      26.9 MB / 27.5 MB
//   bulleted notes with figures     26.5 MB / 27.1 MB
//   markup-heavy Word paragraphs    31.4 MB / 32.2 MB
//   plain paragraphs and tables     33.1 MB / 33.6 MB
// A body declared above this threshold (41.9 MB) is refused before the
// converter starts. It sits about a quarter above the largest body seen to
// convert, so no file that converts today is refused; a body between the
// measured limits and this threshold converts or crashes exactly as before.
export const MAX_CONVERTIBLE_WORD_BODY_BYTES = 40 * 1024 * 1024;

const MAIN_DOCUMENT_PART = 'word/document.xml';
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
// matches the refusal by name. jobFailureReason and UploadService turn it into
// the same code and message as a conversion that ran out of heap.
export function isWordDocumentTooLongError(err: unknown): err is Error {
  return err instanceof Error && err.name === WORD_DOCUMENT_TOO_LONG;
}

// The uncompressed size the zip directory declares for the Word body, read
// without inflating anything. Null when the directory cannot be read or the
// size is missing or implausible, in which case the file converts as before.
export function declaredWordBodyBytes(contents: Buffer): number | null {
  let declared: number | null = null;
  try {
    unzipSync(new Uint8Array(contents), {
      filter: (file) => {
        if (file.name === MAIN_DOCUMENT_PART) {
          const plausible =
            Number.isSafeInteger(file.originalSize) &&
            file.originalSize > 0 &&
            file.originalSize >= file.size;
          declared = plausible ? file.originalSize : null;
        }
        return false;
      },
    });
  } catch {
    return null;
  }
  return declared;
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

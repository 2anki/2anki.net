// A PDF with no usable text can become page-image cards in more than one way.
// When the upload page asks, the conversion stops with this sentinel (it
// survives the worker boundary as a plain message, like the password one) and
// UploadService answers 409 with what the browser needs to offer the choice.
export type PdfFallbackReason = 'no_text' | 'over_split' | 'locked';

const SENTINEL_PREFIX = 'PDF_NEEDS_MODE_CHOICE';
const SEPARATOR = '\x00';

export interface PdfFallbackChoice {
  reason: PdfFallbackReason;
  pageCount: number;
}

export function buildPdfFallbackChoiceSentinel(
  choice: PdfFallbackChoice
): string {
  return [SENTINEL_PREFIX, choice.reason, String(choice.pageCount)].join(
    SEPARATOR
  );
}

export function parsePdfFallbackChoiceSentinel(
  message: string
): PdfFallbackChoice | null {
  const [prefix, reason, pageCount] = message.split(SEPARATOR);
  if (prefix !== SENTINEL_PREFIX) return null;
  if (reason !== 'no_text' && reason !== 'over_split' && reason !== 'locked') {
    return null;
  }
  const pages = Number.parseInt(pageCount ?? '', 10);
  return { reason, pageCount: Number.isFinite(pages) && pages > 0 ? pages : 0 };
}

export function isPdfFallbackChoiceSentinel(message: string): boolean {
  return message.startsWith(`${SENTINEL_PREFIX}${SEPARATOR}`);
}

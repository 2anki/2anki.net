export type PdfFallbackMode = 'pairs' | 'single';
export type PdfFallbackReason = 'no_text' | 'over_split' | 'locked';

export interface PdfChoicePrompt {
  reason: PdfFallbackReason;
  pageCount: number;
}

// The upload page asks about PDFs without readable text; a remembered answer
// rides along with every upload as this card option, like the other options
// the browser keeps.
export const PDF_FALLBACK_OPTION = 'pdf-fallback';

function isMode(value: unknown): value is PdfFallbackMode {
  return value === 'pairs' || value === 'single';
}

export function readRememberedPdfFallback(): PdfFallbackMode | null {
  try {
    const value = globalThis.localStorage.getItem(PDF_FALLBACK_OPTION);
    return isMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberPdfFallback(mode: PdfFallbackMode): void {
  try {
    globalThis.localStorage.setItem(PDF_FALLBACK_OPTION, mode);
  } catch {
    // Without storage the question is simply asked again next time.
  }
}

export function forgetPdfFallback(): void {
  try {
    globalThis.localStorage.removeItem(PDF_FALLBACK_OPTION);
  } catch {
    // Nothing was stored.
  }
}

export function parsePdfFallbackHeader(
  value: string | null
): PdfFallbackMode | null {
  return isMode(value) ? value : null;
}

export function readPdfChoicePrompt(body: unknown): PdfChoicePrompt | null {
  if (body == null || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (record.code !== 'choose_pdf_mode') return null;
  const reason = record.reason;
  if (reason !== 'no_text' && reason !== 'over_split' && reason !== 'locked') {
    return null;
  }
  const pages = record.page_count;
  return {
    reason,
    pageCount: typeof pages === 'number' && pages > 0 ? pages : 0,
  };
}

// A PDF can sit inside a zip, so a zip may need the question too.
export function mayNeedPdfQuestion(files: File[]): boolean {
  return files.some((file) => /\.(pdf|zip)$/i.test(file.name));
}

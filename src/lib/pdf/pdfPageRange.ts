const ECHO_MAX_LENGTH = 24;

export class PdfPageRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfPageRangeError';
  }
}

export function isPdfPageRangeError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'PdfPageRangeError';
}

function echo(part: string): string {
  const trimmed = part.trim();
  return trimmed.length > ECHO_MAX_LENGTH
    ? `${trimmed.slice(0, ECHO_MAX_LENGTH)}...`
    : trimmed;
}

function parsePart(part: string, pages: Set<number>): void {
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start === 0 || end === 0) {
      throw new PdfPageRangeError(
        `Page numbers start at 1, so '${echo(part)}' is not a valid range.`
      );
    }
    if (start > end) {
      throw new PdfPageRangeError(
        `'${echo(part)}' goes backwards. Write the lower page first, like ${end}-${start}.`
      );
    }
    for (let page = start; page <= end; page++) {
      pages.add(page);
    }
    return;
  }

  const single = /^(\d+)$/.exec(part);
  if (single) {
    const page = Number(single[1]);
    if (page === 0) {
      throw new PdfPageRangeError(
        `Page numbers start at 1, so '${echo(part)}' is not a valid page.`
      );
    }
    pages.add(page);
    return;
  }

  throw new PdfPageRangeError(
    `'${echo(part)}' is not a valid page or range. Use page numbers and ranges like 12-30, 45.`
  );
}

export function parsePdfPageRange(
  raw: string | undefined | null
): number[] | null {
  if (raw == null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  const parts = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) {
    return null;
  }
  const pages = new Set<number>();
  for (const part of parts) {
    parsePart(part, pages);
  }
  return [...pages].sort((a, b) => a - b);
}

export function assertPagesWithinDocument(
  pages: number[],
  pageCount: number
): void {
  const beyond = pages.filter((page) => page > pageCount);
  if (beyond.length === 0) {
    return;
  }
  const min = Math.min(...beyond);
  const max = Math.max(...beyond);
  const label = min === max ? `Page ${min} is` : `Pages ${min}-${max} are`;
  throw new PdfPageRangeError(
    `${label} past the end of this ${pageCount}-page PDF.`
  );
}

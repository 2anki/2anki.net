const ECHO_MAX_LENGTH = 24;
const MAX_INPUT_LENGTH = 200;
const MAX_PARTS = 50;
const MAX_DIGITS = 6;

export interface PdfPageSegment {
  start: number;
  end: number;
}

// What went wrong with a page range, with the values the sentence names, so
// the web can say it in the person's language. The English message stays for
// logs, the job failure reason and older clients.
export type PdfPageRangeDetails =
  | { reason: 'too_long'; max: number }
  | { reason: 'too_many_parts'; max: number }
  | { reason: 'number_too_large'; part: string }
  | { reason: 'range_starts_at_zero'; part: string }
  | { reason: 'backwards'; part: string; lower: number; upper: number }
  | { reason: 'page_zero'; part: string }
  | { reason: 'invalid_part'; part: string }
  | { reason: 'past_end'; first: number; last: number; pageCount: number }
  | { reason: 'locked_pdf' }
  | { reason: 'split_timeout' };

export class PdfPageRangeError extends Error {
  constructor(
    message: string,
    readonly details: PdfPageRangeDetails
  ) {
    super(message);
    this.name = 'PdfPageRangeError';
  }
}

export function isPdfPageRangeError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'PdfPageRangeError';
}

const PART_REASONS: ReadonlySet<string> = new Set([
  'number_too_large',
  'range_starts_at_zero',
  'page_zero',
  'invalid_part',
]);
const MAX_REASONS: ReadonlySet<string> = new Set([
  'too_long',
  'too_many_parts',
]);
const BARE_REASONS: ReadonlySet<string> = new Set([
  'locked_pdf',
  'split_timeout',
]);

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

// The details of a page-range error, read back off an error that crossed the
// conversion child as plain data. Anything that does not match one shape is
// none, and the answer falls back to the English message.
export function pdfPageRangeDetailsOf(
  error: unknown
): PdfPageRangeDetails | null {
  const details = (error as { details?: unknown } | null)?.details;
  if (details == null || typeof details !== 'object') return null;
  const value = details as Record<string, unknown>;
  const { reason } = value;
  if (typeof reason !== 'string') return null;
  if (BARE_REASONS.has(reason)) {
    return { reason } as PdfPageRangeDetails;
  }
  if (MAX_REASONS.has(reason) && isCount(value.max)) {
    return { reason, max: value.max } as PdfPageRangeDetails;
  }
  if (PART_REASONS.has(reason) && typeof value.part === 'string') {
    return { reason, part: value.part } as PdfPageRangeDetails;
  }
  if (
    reason === 'backwards' &&
    typeof value.part === 'string' &&
    isCount(value.lower) &&
    isCount(value.upper)
  ) {
    return {
      reason,
      part: value.part,
      lower: value.lower,
      upper: value.upper,
    };
  }
  if (
    reason === 'past_end' &&
    isCount(value.first) &&
    isCount(value.last) &&
    isCount(value.pageCount)
  ) {
    return {
      reason,
      first: value.first,
      last: value.last,
      pageCount: value.pageCount,
    };
  }
  return null;
}

function echo(part: string): string {
  const trimmed = part.trim();
  return trimmed.length > ECHO_MAX_LENGTH
    ? `${trimmed.slice(0, ECHO_MAX_LENGTH)}...`
    : trimmed;
}

// Bound the digit count before parseInt so a page number can never be large
// enough to drive a runaway expansion; the real page-count check in
// resolvePdfPages rejects anything past the document anyway.
function parsePageNumber(token: string, part: string): number {
  if (token.length > MAX_DIGITS) {
    throw new PdfPageRangeError(
      `'${echo(part)}' has a page number that is too large. Use page numbers from your PDF, like 12-30, 45.`,
      { reason: 'number_too_large', part: echo(part) }
    );
  }
  return Number(token);
}

function parseSegment(part: string): PdfPageSegment {
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(part);
  if (range) {
    const start = parsePageNumber(range[1], part);
    const end = parsePageNumber(range[2], part);
    if (start === 0 || end === 0) {
      throw new PdfPageRangeError(
        `Page numbers start at 1, so '${echo(part)}' is not a valid range.`,
        { reason: 'range_starts_at_zero', part: echo(part) }
      );
    }
    if (start > end) {
      throw new PdfPageRangeError(
        `'${echo(part)}' goes backwards. Write the lower page first, like ${end}-${start}.`,
        { reason: 'backwards', part: echo(part), lower: end, upper: start }
      );
    }
    return { start, end };
  }

  const single = /^(\d+)$/.exec(part);
  if (single) {
    const page = parsePageNumber(single[1], part);
    if (page === 0) {
      throw new PdfPageRangeError(
        `Page numbers start at 1, so '${echo(part)}' is not a valid page.`,
        { reason: 'page_zero', part: echo(part) }
      );
    }
    return { start: page, end: page };
  }

  throw new PdfPageRangeError(
    `'${echo(part)}' is not a valid page or range. Use page numbers and ranges like 12-30, 45.`,
    { reason: 'invalid_part', part: echo(part) }
  );
}

// Parses the raw field into page segments WITHOUT expanding ranges, so a
// hostile value like 1-999999999 can never allocate a page list. Empty means
// all pages (null). Throws PdfPageRangeError on a value that is too long, has
// too many parts, or holds a malformed token, page 0, an over-long number, or a
// descending range. Ranges are expanded only later, in resolvePdfPages, where
// they are first clamped against the real page count.
export function parsePdfPageRange(
  raw: string | undefined | null
): PdfPageSegment[] | null {
  if (raw == null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  if (trimmed.length > MAX_INPUT_LENGTH) {
    throw new PdfPageRangeError(
      `That page range is too long. Keep it under ${MAX_INPUT_LENGTH} characters.`,
      { reason: 'too_long', max: MAX_INPUT_LENGTH }
    );
  }
  const parts = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) {
    return null;
  }
  if (parts.length > MAX_PARTS) {
    throw new PdfPageRangeError(
      `That is too many page ranges. Use at most ${MAX_PARTS}.`,
      { reason: 'too_many_parts', max: MAX_PARTS }
    );
  }
  return parts.map(parseSegment);
}

// Rejects any segment that reaches past the end of the document BEFORE building
// a page list, so expansion is always bounded by the real page count. Returns a
// sorted, de-duped list of 1-based page numbers.
export function resolvePdfPages(
  segments: PdfPageSegment[],
  pageCount: number
): number[] {
  let minBeyond = Infinity;
  let maxBeyond = -Infinity;
  for (const { start, end } of segments) {
    if (end > pageCount) {
      minBeyond = Math.min(minBeyond, Math.max(start, pageCount + 1));
      maxBeyond = Math.max(maxBeyond, end);
    }
  }
  if (maxBeyond !== -Infinity) {
    const label =
      minBeyond === maxBeyond
        ? `Page ${minBeyond} is`
        : `Pages ${minBeyond}-${maxBeyond} are`;
    throw new PdfPageRangeError(
      `${label} past the end of this ${pageCount}-page PDF.`,
      { reason: 'past_end', first: minBeyond, last: maxBeyond, pageCount }
    );
  }

  const pages = new Set<number>();
  for (const { start, end } of segments) {
    for (let page = start; page <= end; page++) {
      pages.add(page);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

import type {
  TooLongSetting,
  UploadErrorBody,
} from '@server/types/UploadErrorBody';

type PageRange = NonNullable<UploadErrorBody['page_range']>;

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

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
const SETTINGS: ReadonlySet<string> = new Set([
  'user_instructions',
  'deck_name',
]);

// A page range answer's details off the wire. Anything that does not match one
// shape is dropped, and the page shows the server's sentence instead.
export function readPageRangeDetails(value: unknown): PageRange | undefined {
  if (value == null || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const { reason } = v;
  if (typeof reason !== 'string') return undefined;
  if (BARE_REASONS.has(reason)) return { reason } as PageRange;
  if (MAX_REASONS.has(reason) && isCount(v.max)) {
    return { reason, max: v.max } as PageRange;
  }
  if (PART_REASONS.has(reason) && typeof v.part === 'string') {
    return { reason, part: v.part } as PageRange;
  }
  if (
    reason === 'backwards' &&
    typeof v.part === 'string' &&
    isCount(v.lower) &&
    isCount(v.upper)
  ) {
    return { reason, part: v.part, lower: v.lower, upper: v.upper };
  }
  if (
    reason === 'past_end' &&
    isCount(v.first) &&
    isCount(v.last) &&
    isCount(v.pageCount)
  ) {
    return { reason, first: v.first, last: v.last, pageCount: v.pageCount };
  }
  return undefined;
}

export function readTooLongSetting(value: unknown): TooLongSetting | undefined {
  return typeof value === 'string' && SETTINGS.has(value)
    ? (value as TooLongSetting)
    : undefined;
}

import type { ConversionErrorCount } from '../types/ops/ConversionMetrics';

const EXCLUDED_CODES = new Set(['monthly_limit']);

const STEM_LENGTH = 40;
const PROSE_THRESHOLD = STEM_LENGTH;

const KNOWN_PROSE_BUCKETS: Array<{ prefix: string; code: string }> = [
  { prefix: 'No cards in this deck yet.', code: 'empty_deck' },
];

interface RawFailureRow {
  reason: string;
  count: number;
}

function codeFromJsonBlob(reason: string): string | null {
  if (!reason.trimStart().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(reason) as { code?: unknown };
    if (typeof parsed.code === 'string' && parsed.code.length > 0) {
      return parsed.code;
    }
  } catch {
    return null;
  }
  return null;
}

function bucketProse(reason: string): string {
  const known = KNOWN_PROSE_BUCKETS.find((bucket) =>
    reason.startsWith(bucket.prefix)
  );
  if (known) return known.code;
  if (reason.length > PROSE_THRESHOLD) {
    return `${reason.slice(0, STEM_LENGTH).trimEnd()}…`;
  }
  return reason;
}

function normalizeReason(reason: string): string {
  const code = codeFromJsonBlob(reason);
  if (code != null) return code;
  return bucketProse(reason);
}

export function normalizeFailureReasons(
  rows: RawFailureRow[]
): ConversionErrorCount[] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const normalized = normalizeReason(row.reason);
    if (EXCLUDED_CODES.has(normalized)) continue;
    totals.set(normalized, (totals.get(normalized) ?? 0) + Number(row.count));
  }

  return Array.from(totals.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

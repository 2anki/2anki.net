import type {
  ConversionReport,
  ConversionReportEntry,
} from './buildConversionReport';

const STAGES: ReadonlySet<string> = new Set([
  'block',
  'media',
  'card',
  'output',
]);

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toEntry(value: unknown): ConversionReportEntry | null {
  if (typeof value !== 'object' || value == null) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.stage !== 'string' ||
    !STAGES.has(entry.stage) ||
    typeof entry.reason_code !== 'string' ||
    typeof entry.human_reason !== 'string' ||
    !isCount(entry.count)
  ) {
    return null;
  }
  return {
    stage: entry.stage as ConversionReportEntry['stage'],
    reason_code: entry.reason_code,
    human_reason: entry.human_reason,
    count: entry.count,
  };
}

/**
 * Maps a stored jobs.conversion_report value (a jsonb object from Postgres,
 * JSON text from the sqlite test double) to the typed report the API serves.
 * Anything malformed maps to null so the client sees "no report", never a
 * raw or partial row.
 */
export function toConversionReport(value: unknown): ConversionReport | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed == null) {
    return null;
  }
  const raw = parsed as Record<string, unknown>;
  const summary =
    typeof raw.summary === 'object' && raw.summary != null
      ? (raw.summary as Record<string, unknown>)
      : undefined;
  const blocksSeen = summary?.blocks_seen;
  const cardsCreated = summary?.cards_created;
  const blocksSkipped = summary?.blocks_skipped;
  if (
    !isCount(blocksSeen) ||
    !isCount(cardsCreated) ||
    !isCount(blocksSkipped) ||
    !Array.isArray(raw.entries)
  ) {
    return null;
  }
  const entries: ConversionReportEntry[] = [];
  for (const candidate of raw.entries) {
    const entry = toEntry(candidate);
    if (entry == null) {
      return null;
    }
    entries.push(entry);
  }
  const report: ConversionReport = {
    summary: {
      blocks_seen: blocksSeen,
      cards_created: cardsCreated,
      blocks_skipped: blocksSkipped,
    },
    entries,
  };
  if (raw.truncated === true) {
    report.truncated = true;
  }
  if (isCount(raw.omitted_entry_count)) {
    report.omitted_entry_count = raw.omitted_entry_count;
  }
  return report;
}

import type { ConversionTruncation } from './conversionTruncation';

/**
 * Per-conversion accounting persisted on jobs.conversion_report (#4211).
 * Entries aggregate by reason, so cardinality is bounded by Notion's block
 * vocabulary; MAX_REPORT_ENTRIES guards a crafted export with thousands of
 * distinct types — past the cap, known reasons keep counting, new ones are
 * only tallied in omitted_entry_count. reason_code is the stable key the web
 * report renders (localized) from; human_reason is the English fallback for
 * ops reading the raw row.
 */
export interface ConversionReportEntry {
  stage: 'block' | 'media' | 'card' | 'output';
  reason_code: string;
  human_reason: string;
  count: number;
}

export interface ConversionReport {
  summary: {
    blocks_seen: number;
    cards_created: number;
    blocks_skipped: number;
  };
  entries: ConversionReportEntry[];
  truncated?: boolean;
  omitted_entry_count?: number;
}

export interface ConversionReportInput {
  blocksSeen: number;
  cardsCreated: number;
  emptyBackCount: number;
  droppedAssetCount: number;
  forbiddenBlockCount: number;
  unsupportedBlockTypeCounts?: Map<string, number>;
  truncation?: ConversionTruncation;
}

export const MAX_REPORT_ENTRIES = 50;

export function buildConversionReport(
  input: ConversionReportInput
): ConversionReport {
  const entries: ConversionReportEntry[] = [];
  let omitted = 0;

  const push = (entry: ConversionReportEntry) => {
    // A missing counter counts as zero — a report entry without a positive
    // count is noise.
    if ((entry.count ?? 0) <= 0) {
      return;
    }
    if (entries.length >= MAX_REPORT_ENTRIES) {
      omitted += entry.count;
      return;
    }
    entries.push(entry);
  };

  push({
    stage: 'block',
    reason_code: 'blocks_forbidden',
    human_reason: 'Blocks in parts of the page that are not shared',
    count: input.forbiddenBlockCount,
  });
  push({
    stage: 'card',
    reason_code: 'empty_back',
    human_reason: 'Cards whose back came out empty',
    count: input.emptyBackCount,
  });
  push({
    stage: 'media',
    reason_code: 'assets_dropped',
    human_reason: 'Images or files that could not be included',
    count: input.droppedAssetCount,
  });
  if (input.truncation != null) {
    push({
      stage: 'output',
      reason_code: 'truncated',
      human_reason: 'The conversion stopped before the end of the page',
      count: 1,
    });
  }
  for (const [type, count] of input.unsupportedBlockTypeCounts ?? new Map()) {
    push({
      stage: 'block',
      reason_code: `unsupported_block:${type}`,
      human_reason: `Blocks of a type that cannot become cards yet (${type})`,
      count,
    });
  }

  const blocksSkipped = entries
    .filter((entry) => entry.stage !== 'output')
    .reduce((sum, entry) => sum + entry.count, 0);

  const report: ConversionReport = {
    summary: {
      blocks_seen: input.blocksSeen ?? 0,
      cards_created: input.cardsCreated ?? 0,
      blocks_skipped: blocksSkipped + omitted,
    },
    entries,
  };
  if (omitted > 0) {
    report.truncated = true;
    report.omitted_entry_count = omitted;
  }
  return report;
}

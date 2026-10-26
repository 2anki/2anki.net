import { toConversionReport } from './toConversionReport';

const CHERRY_SKIPPED = 'cherry_skipped';

/**
 * Number of toggles Cherry-pick left out of a conversion, from the stored
 * report. Served on the polled jobs list as one integer so the Downloads row
 * can say why a deck is smaller than the page. Null or malformed reads as 0.
 */
export function getCherrySkippedCount(storedReport: unknown): number {
  const report = toConversionReport(storedReport);
  if (report == null) {
    return 0;
  }
  return report.entries
    .filter((entry) => entry.reason_code === CHERRY_SKIPPED)
    .reduce((sum, entry) => sum + entry.count, 0);
}

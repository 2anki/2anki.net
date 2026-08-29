import { toConversionReport } from './toConversionReport';

const EMPTY_BACK = 'empty_back';

/**
 * Number of toggles the stored conversion report counted as empty. Served on
 * the polled jobs list as a single integer so the Downloads row can say why a
 * deck came back thin without shipping the whole report (#4211 keeps that
 * lazy). Anything null or malformed reads as 0.
 */
export function getEmptyBackCount(storedReport: unknown): number {
  const report = toConversionReport(storedReport);
  if (report == null) {
    return 0;
  }
  return report.entries
    .filter((entry) => entry.reason_code === EMPTY_BACK)
    .reduce((sum, entry) => sum + entry.count, 0);
}

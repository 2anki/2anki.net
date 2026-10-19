import type JobResponse from '@server/types/JobResponse';

const NOTION_PAGE_JOB_TYPES = new Set(['page', 'database']);

/**
 * Whether a done Notion conversion stopped before the end of the page. Reads
 * the `blocks_converted` field, which the signal payload writes whenever the
 * conversion truncated at all — page-level or a nested toggle/table/column/
 * section cut short on the free plan (then the count is 0). Field-based, not
 * code-gated, so a truncation that co-occurs with a higher-priority signal
 * (forbidden blocks, structure rescued) still reads as partial.
 */
export function hasTruncationSignal(job: JobResponse): boolean {
  if (job.status !== 'done') return false;
  if (job.type == null || !NOTION_PAGE_JOB_TYPES.has(job.type)) return false;
  if (job.job_reason_failure == null || job.job_reason_failure === '') {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(job.job_reason_failure);
  } catch {
    return false;
  }
  if (parsed == null || typeof parsed !== 'object') return false;
  return (
    typeof (parsed as { blocks_converted?: unknown }).blocks_converted ===
    'number'
  );
}

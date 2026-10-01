import type JobResponse from '@server/types/JobResponse';

const NOTION_PAGE_JOB_TYPES = new Set(['page', 'database']);

export function parseUnsupportedBlocksPayload(
  job: JobResponse
): Record<string, number> | null {
  if (job.status !== 'done') return null;
  if (job.type == null || !NOTION_PAGE_JOB_TYPES.has(job.type)) return null;
  if (job.job_reason_failure == null || job.job_reason_failure === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(job.job_reason_failure);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== 'object') return null;
  const unsupported = (parsed as { unsupported_blocks?: unknown })
    .unsupported_blocks;
  if (unsupported == null || typeof unsupported !== 'object') return null;
  const counts: Record<string, number> = {};
  for (const [type, count] of Object.entries(unsupported)) {
    if (Number.isInteger(count) && (count as number) > 0) {
      counts[type] = count as number;
    }
  }
  if (Object.keys(counts).length === 0) return null;
  return counts;
}

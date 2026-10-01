import type JobResponse from '@server/types/JobResponse';

export interface GuessedColumns {
  frontField: string;
  backField: string;
}

const NOTION_PAGE_JOB_TYPES = new Set(['page', 'database']);

export function parseColumnsGuessedPayload(
  job: JobResponse
): GuessedColumns | null {
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
  const payload = parsed as { front_field?: unknown; back_field?: unknown };
  if (
    typeof payload.front_field !== 'string' ||
    typeof payload.back_field !== 'string' ||
    payload.front_field === '' ||
    payload.back_field === ''
  ) {
    return null;
  }
  return { frontField: payload.front_field, backField: payload.back_field };
}

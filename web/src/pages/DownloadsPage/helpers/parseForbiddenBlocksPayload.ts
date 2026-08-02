import JobResponse from '../../../schemas/public/JobResponse';

const NOTION_PAGE_JOB_TYPES = new Set(['page', 'database']);

export function parseForbiddenBlocksPayload(
  job: JobResponse
): { count: number } | null {
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
  const payload = parsed as { code?: unknown; forbidden_blocks?: unknown };
  if (payload.code !== 'notion_blocks_forbidden') return null;
  const count = Number(payload.forbidden_blocks);
  if (!Number.isInteger(count) || count <= 0) return null;
  return { count };
}

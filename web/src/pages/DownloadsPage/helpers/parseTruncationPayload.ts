import type JobResponse from '@server/types/JobResponse';
import { NOTION_TRUNCATED_CODE } from './conversionSignalCodes';

export interface TruncationPayload {
  blocksConverted: number;
  subDeckRulesSkipped: boolean;
}

const NOTION_PAGE_JOB_TYPES = new Set(['page', 'database']);

export function parseTruncationPayload(
  job: JobResponse
): TruncationPayload | null {
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
  const payload = parsed as {
    code?: unknown;
    blocks_converted?: unknown;
    sub_deck_rules_skipped?: unknown;
  };
  if (payload.code !== NOTION_TRUNCATED_CODE) return null;
  const blocksConverted = Number(payload.blocks_converted);
  if (!Number.isFinite(blocksConverted) || blocksConverted <= 0) return null;
  return {
    blocksConverted,
    subDeckRulesSkipped: payload.sub_deck_rules_skipped === true,
  };
}

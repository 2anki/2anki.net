import type JobResponse from '@server/types/JobResponse';
import { MONTHLY_LIMIT_PARTIAL_CODE } from './conversionSignalCodes';

export interface MonthlyLimitPartialPayload {
  cardsDelivered: number;
  cardsHeldBack: number;
  limit: number;
  resetOn?: string;
}

const NOTION_PAGE_JOB_TYPES = new Set(['page', 'database']);

export function parseMonthlyLimitPartialPayload(
  job: JobResponse
): MonthlyLimitPartialPayload | null {
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
    cards_delivered?: unknown;
    cards_held_back?: unknown;
    limit?: unknown;
    reset_on?: unknown;
  };
  if (payload.code !== MONTHLY_LIMIT_PARTIAL_CODE) return null;
  const cardsDelivered = Number(payload.cards_delivered);
  const cardsHeldBack = Number(payload.cards_held_back);
  const limit = Number(payload.limit);
  if (!Number.isFinite(cardsDelivered) || cardsDelivered < 0) return null;
  if (!Number.isFinite(cardsHeldBack) || cardsHeldBack <= 0) return null;
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return {
    cardsDelivered,
    cardsHeldBack,
    limit,
    resetOn:
      typeof payload.reset_on === 'string' ? payload.reset_on : undefined,
  };
}

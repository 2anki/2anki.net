import type JobResponse from '@server/types/JobResponse';
import { NOTION_STRUCTURE_RESCUED_CODE } from './conversionSignalCodes';

export const STRUCTURE_RESCUE_RULES = [
  'heading',
  'bullets',
  'numbered',
  'columns',
  'quote',
  'guess',
] as const;

export type StructureRescueRule = (typeof STRUCTURE_RESCUE_RULES)[number];

const NOTION_PAGE_JOB_TYPES = new Set(['page', 'database']);

function isRescueRule(value: unknown): value is StructureRescueRule {
  return (
    typeof value === 'string' &&
    (STRUCTURE_RESCUE_RULES as readonly string[]).includes(value)
  );
}

export function parseStructureRescuedPayload(
  job: JobResponse
): { rule: StructureRescueRule } | null {
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
  const payload = parsed as { code?: unknown; rule?: unknown };
  if (payload.code !== NOTION_STRUCTURE_RESCUED_CODE) return null;
  if (!isRescueRule(payload.rule)) return null;
  return { rule: payload.rule };
}

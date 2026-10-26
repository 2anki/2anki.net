import type {
  RescueCandidate,
  RescueRule,
} from '@server/types/RescueCandidate';

export type { RescueCandidate, RescueRule };

// `satisfies` keeps this list in step with the server vocabulary at
// typecheck time; the runtime list is what the 400 body is checked against.
export const RESCUE_RULES = [
  'columns',
  'heading',
  'quote',
  'numbered',
  'bullets',
  'guess',
  'paragraphs',
] as const satisfies readonly RescueRule[];

function isSample(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (card) =>
        card != null &&
        typeof card === 'object' &&
        typeof (card as Record<string, unknown>).front === 'string' &&
        typeof (card as Record<string, unknown>).back === 'string'
    )
  );
}

export function isRescueCandidate(value: unknown): value is RescueCandidate {
  if (value == null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.rule === 'string' &&
    (RESCUE_RULES as readonly string[]).includes(record.rule) &&
    typeof record.cards === 'number' &&
    Number.isSafeInteger(record.cards) &&
    record.cards > 0 &&
    (record.sample === undefined || isSample(record.sample))
  );
}

export function readRescueCandidates(value: unknown): RescueCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRescueCandidate);
}

// The structural shapes a zero-card conversion can be re-derived from, offered
// back to the user as a choice when none of them cleared the quality floor on
// its own. Shared with the web app, so the vocabulary and the guard live here.
export const RESCUE_RULES = [
  'columns',
  'heading',
  'quote',
  'numbered',
  'bullets',
  'guess',
] as const;

export type RescueRule = (typeof RESCUE_RULES)[number];

export interface RescueCandidate {
  rule: RescueRule;
  cards: number;
}

export function isRescueRule(value: unknown): value is RescueRule {
  return (
    typeof value === 'string' &&
    (RESCUE_RULES as readonly string[]).includes(value)
  );
}

export function isRescueCandidate(value: unknown): value is RescueCandidate {
  if (value == null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    isRescueRule(record.rule) &&
    typeof record.cards === 'number' &&
    Number.isInteger(record.cards) &&
    record.cards > 0
  );
}

// A conversion walks several sub-decks and each may offer candidates; the
// user sees one list, so counts add up per rule in the fixed rule order.
export function mergeRescueCandidates(
  lists: readonly (readonly RescueCandidate[])[]
): RescueCandidate[] {
  const totals = new Map<RescueRule, number>();
  for (const list of lists) {
    for (const candidate of list) {
      totals.set(
        candidate.rule,
        (totals.get(candidate.rule) ?? 0) + candidate.cards
      );
    }
  }
  return RESCUE_RULES.filter((rule) => (totals.get(rule) ?? 0) > 0).map(
    (rule) => ({ rule, cards: totals.get(rule) as number })
  );
}

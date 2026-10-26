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
  'paragraphs',
] as const;

export type RescueRule = (typeof RESCUE_RULES)[number];

export interface RescueSampleCard {
  front: string;
  back: string;
}

export interface RescueCandidate {
  rule: RescueRule;
  cards: number;
  // The first few cards this rule would make, as plain text, so the empty
  // deck screen can show what the choice produces before the person picks it.
  sample?: RescueSampleCard[];
}

export const RESCUE_SAMPLE_SIZE = 3;
const SAMPLE_FRONT_CHARS = 120;
const SAMPLE_BACK_CHARS = 160;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export function toRescueSample(
  cards: readonly { name: string; back: string }[],
  toText: (html: string) => string
): RescueSampleCard[] {
  return cards.slice(0, RESCUE_SAMPLE_SIZE).map((card) => ({
    front: clip(toText(card.name), SAMPLE_FRONT_CHARS),
    back: clip(toText(card.back), SAMPLE_BACK_CHARS),
  }));
}

function isRescueSample(value: unknown): value is RescueSampleCard[] {
  return (
    Array.isArray(value) &&
    value.every(
      (card) =>
        card != null &&
        typeof card === 'object' &&
        typeof (card as RescueSampleCard).front === 'string' &&
        typeof (card as RescueSampleCard).back === 'string'
    )
  );
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
    record.cards > 0 &&
    (record.sample === undefined || isRescueSample(record.sample))
  );
}

// A conversion walks several sub-decks and each may offer candidates; the
// user sees one list, so counts add up per rule in the fixed rule order.
export function mergeRescueCandidates(
  lists: readonly (readonly RescueCandidate[])[]
): RescueCandidate[] {
  const totals = new Map<RescueRule, number>();
  const samples = new Map<RescueRule, RescueSampleCard[]>();
  for (const list of lists) {
    for (const candidate of list) {
      totals.set(
        candidate.rule,
        (totals.get(candidate.rule) ?? 0) + candidate.cards
      );
      if (candidate.sample != null) {
        samples.set(
          candidate.rule,
          [...(samples.get(candidate.rule) ?? []), ...candidate.sample].slice(
            0,
            RESCUE_SAMPLE_SIZE
          )
        );
      }
    }
  }
  return RESCUE_RULES.filter((rule) => (totals.get(rule) ?? 0) > 0).map(
    (rule) => {
      const sample = samples.get(rule);
      return sample != null && sample.length > 0
        ? { rule, cards: totals.get(rule) as number, sample }
        : { rule, cards: totals.get(rule) as number };
    }
  );
}

export const DECK_DISTRIBUTION_ANSWERS = [
  'students',
  'customers',
  'study_group',
  'colleagues',
  'just_me',
] as const;

export type DeckDistributionAnswer = (typeof DECK_DISTRIBUTION_ANSWERS)[number];

const KNOWN_ANSWERS = new Set<string>(DECK_DISTRIBUTION_ANSWERS);

export function isKnownDeckDistributionAnswer(
  value: unknown
): value is DeckDistributionAnswer {
  return typeof value === 'string' && KNOWN_ANSWERS.has(value);
}

export const CLAUDE_CARDS_SWITCHED_BY_GIFT_KEY =
  '2anki-claude-cards-switched-by-gift';

export interface GiftSwitchMark {
  userId: number;
  previous: string | null;
  previousChoiceAt: string | null;
}

const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

export function readGiftSwitchMark(): GiftSwitchMark | null {
  const raw = globalThis.localStorage?.getItem(
    CLAUDE_CARDS_SWITCHED_BY_GIFT_KEY
  );
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed != null &&
      typeof parsed === 'object' &&
      'userId' in parsed &&
      typeof parsed.userId === 'number' &&
      'previous' in parsed &&
      nullableString(parsed.previous) &&
      'previousChoiceAt' in parsed &&
      nullableString(parsed.previousChoiceAt)
    ) {
      return {
        userId: parsed.userId,
        previous: parsed.previous,
        previousChoiceAt: parsed.previousChoiceAt,
      };
    }
  } catch {
    return { userId: -1, previous: null, previousChoiceAt: null };
  }
  return { userId: -1, previous: null, previousChoiceAt: null };
}

export function forgetGiftSwitchMark(): void {
  globalThis.localStorage?.removeItem(CLAUDE_CARDS_SWITCHED_BY_GIFT_KEY);
}

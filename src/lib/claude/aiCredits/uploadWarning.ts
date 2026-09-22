export const AI_CREDITS_EXHAUSTED_WARNING_CODE = 'ai-credits-exhausted';

export const AI_CREDITS_EXHAUSTED_WARNING_TEXT =
  "You're out of AI credits, so this deck was built without AI. A one-time " +
  'top-up, no subscription, adds enough for several more decks and stays good ' +
  'for 90 days. Or wait for your free reset.';

export function includesAiCreditsWarning(
  warnings: string[] | undefined
): boolean {
  if (warnings == null) {
    return false;
  }
  return warnings.includes(AI_CREDITS_EXHAUSTED_WARNING_CODE);
}

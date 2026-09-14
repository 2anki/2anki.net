export const AI_CREDITS_EXHAUSTED_WARNING_CODE = 'ai-credits-exhausted';

export const AI_CREDITS_EXHAUSTED_WARNING_TEXT =
  "You're out of AI credits, so this deck was built without AI. AI credits " +
  'come back when your allowance resets.';

export function includesAiCreditsWarning(
  warnings: string[] | undefined
): boolean {
  if (warnings == null) {
    return false;
  }
  return warnings.includes(AI_CREDITS_EXHAUSTED_WARNING_CODE);
}

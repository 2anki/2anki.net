import { CreditWindowReset } from './allowance';

export const AI_CREDITS_EXHAUSTED_WARNING_CODE = 'ai-credits-exhausted';

const AI_CREDITS_EXHAUSTED_WARNING_PLAN =
  "You're out of AI credits, so this deck was built without AI. A one-time " +
  'top-up adds enough for several more decks and stays good for 90 days. Or ' +
  "wait for your plan's credits to reset.";

const AI_CREDITS_EXHAUSTED_WARNING_PASS =
  "You're out of AI credits, so this deck was built without AI. A one-time " +
  'top-up adds enough for several more decks.';

export function aiCreditsExhaustedWarningText(
  resets: CreditWindowReset | null
): string {
  if (resets === 'period' || resets === 'month') {
    return AI_CREDITS_EXHAUSTED_WARNING_PLAN;
  }
  return AI_CREDITS_EXHAUSTED_WARNING_PASS;
}

export function includesAiCreditsWarning(
  warnings: string[] | undefined
): boolean {
  if (warnings == null) {
    return false;
  }
  return warnings.includes(AI_CREDITS_EXHAUSTED_WARNING_CODE);
}

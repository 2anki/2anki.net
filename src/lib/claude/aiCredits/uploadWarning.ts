import { CreditWindowReset } from './allowance';

export const AI_CREDITS_EXHAUSTED_WARNING_CODE = 'ai-credits-exhausted';

export type AiCreditsWarningAudience = CreditWindowReset | 'signed-out-pass';

const AI_CREDITS_EXHAUSTED_WARNING_PLAN =
  "You're out of AI credits, so this deck was built without AI. A one-time " +
  'top-up adds enough for several more decks and stays good for 90 days. Or ' +
  "wait for your plan's credits to reset.";

const AI_CREDITS_EXHAUSTED_WARNING_PASS =
  "You're out of AI credits, so this deck was built without AI. A one-time " +
  'top-up adds enough for several more decks.';

const AI_CREDITS_EXHAUSTED_WARNING_SIGNED_OUT_PASS =
  "You're out of AI credits, so this deck was built without AI. Sign in to " +
  'add a one-time top-up for several more decks.';

export function aiCreditsExhaustedWarningText(
  audience: AiCreditsWarningAudience | null
): string {
  if (audience === 'period' || audience === 'month') {
    return AI_CREDITS_EXHAUSTED_WARNING_PLAN;
  }
  if (audience === 'signed-out-pass') {
    return AI_CREDITS_EXHAUSTED_WARNING_SIGNED_OUT_PASS;
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

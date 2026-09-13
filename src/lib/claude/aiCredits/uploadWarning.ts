export const AI_CREDITS_EXHAUSTED_WARNING_CODE = 'ai-credits-exhausted';

export const AI_CREDITS_EXHAUSTED_WARNING_TEXT =
  "You're out of AI credits, so this deck was built without AI. AI credits " +
  'come back when your allowance resets.';

const AI_CREDITS_SHORT_WARNING_RE = /^ai-credits-short:(\d+):(\d+)$/;

// A deck refused because the estimated cost exceeded the remaining balance,
// not because the balance was zero — the user still has credits, just not
// enough for this file.
export function buildAiCreditsShortWarning(
  neededCredits: number,
  availableCredits: number
): string {
  return `ai-credits-short:${neededCredits}:${availableCredits}`;
}

export function aiCreditsShortWarningText(
  neededCredits: number,
  availableCredits: number
): string {
  return (
    `This file needs about ${neededCredits} AI credits and you have ` +
    `${availableCredits}, so it was built without AI.`
  );
}

export function resolveAiCreditsShortWarning(code: string): string | null {
  const match = AI_CREDITS_SHORT_WARNING_RE.exec(code);
  if (match == null) {
    return null;
  }
  return aiCreditsShortWarningText(Number(match[1]), Number(match[2]));
}

export function includesAiCreditsWarning(
  warnings: string[] | undefined
): boolean {
  if (warnings == null) {
    return false;
  }
  return warnings.some(
    (w) =>
      w === AI_CREDITS_EXHAUSTED_WARNING_CODE ||
      AI_CREDITS_SHORT_WARNING_RE.test(w)
  );
}

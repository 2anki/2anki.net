import { saveValueInLocalStorage } from './saveValueInLocalStorage';

export const AI_CHOICE_AT_KEY = 'ai-choice-at';

export function recordAiChoice(): void {
  saveValueInLocalStorage(
    AI_CHOICE_AT_KEY,
    String(Math.floor(Date.now() / 1000)),
    null
  );
}

export function hasRecordedAiChoice(): boolean {
  const recorded = globalThis.localStorage?.getItem(AI_CHOICE_AT_KEY);
  return recorded != null && recorded !== '';
}

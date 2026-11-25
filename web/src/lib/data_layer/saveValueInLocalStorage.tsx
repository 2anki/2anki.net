import { forgetGiftSwitchMark } from './claudeCardsGiftMark';
import { scheduleSync } from './userPreferencesSync';

export const saveValueInLocalStorage = (
  key: string,
  value: string,
  pageId: string | null
) => {
  if (pageId) {
    return;
  }
  if (key === 'claude-ai-flashcards') {
    forgetGiftSwitchMark();
  }
  localStorage.setItem(key, value);
  scheduleSync();
};

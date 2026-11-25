import { CLAUDE_CARDS_SWITCHED_BY_GIFT_KEY } from './claudeCardsGiftMark';
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
    localStorage.removeItem(CLAUDE_CARDS_SWITCHED_BY_GIFT_KEY);
  }
  localStorage.setItem(key, value);
  scheduleSync();
};

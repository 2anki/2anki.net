import { useEffect, useState } from 'react';
import { AI_CHOICE_AT_KEY } from './aiChoice';
import { CLAUDE_CARDS_SWITCHED_BY_GIFT_KEY } from './claudeCardsGiftMark';

export const CLAUDE_CARDS_KEY = 'claude-ai-flashcards';
export const CLAUDE_CARDS_CHANGE_EVENT = '2anki:claude-cards-change';

export function claudeCardsSwitchedOn(): boolean {
  return globalThis.localStorage?.getItem(CLAUDE_CARDS_KEY) === 'true';
}

// Switched for a free gift, so it stays in this browser and never reaches the
// account's saved settings, where it would outlive the gift. Setting the
// switch by hand clears the mark and syncs as before.
export function switchClaudeCardsOnForThisBrowser(): void {
  const store = globalThis.localStorage;
  if (store == null) return;
  store.setItem(CLAUDE_CARDS_KEY, 'true');
  store.setItem(AI_CHOICE_AT_KEY, String(Math.floor(Date.now() / 1000)));
  store.setItem(CLAUDE_CARDS_SWITCHED_BY_GIFT_KEY, '1');
  globalThis.dispatchEvent(new Event(CLAUDE_CARDS_CHANGE_EVENT));
}

export function useClaudeCardsSwitchedOn(): boolean {
  const [on, setOn] = useState(claudeCardsSwitchedOn);
  useEffect(() => {
    const refresh = () => setOn(claudeCardsSwitchedOn());
    refresh();
    globalThis.addEventListener(CLAUDE_CARDS_CHANGE_EVENT, refresh);
    globalThis.addEventListener('storage', refresh);
    return () => {
      globalThis.removeEventListener(CLAUDE_CARDS_CHANGE_EVENT, refresh);
      globalThis.removeEventListener('storage', refresh);
    };
  }, []);
  return on;
}

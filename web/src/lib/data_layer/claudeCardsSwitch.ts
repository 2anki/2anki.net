import { useEffect, useState } from 'react';
import { recordAiChoice } from './aiChoice';
import { saveValueInLocalStorage } from './saveValueInLocalStorage';

export const CLAUDE_CARDS_KEY = 'claude-ai-flashcards';
export const CLAUDE_CARDS_CHANGE_EVENT = '2anki:claude-cards-change';

export function claudeCardsSwitchedOn(): boolean {
  return globalThis.localStorage?.getItem(CLAUDE_CARDS_KEY) === 'true';
}

export function switchClaudeCardsOn(): void {
  saveValueInLocalStorage(CLAUDE_CARDS_KEY, 'true', null);
  recordAiChoice();
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

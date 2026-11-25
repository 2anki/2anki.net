import { useEffect, useState } from 'react';
import { AI_CHOICE_AT_KEY } from './aiChoice';
import {
  CLAUDE_CARDS_SWITCHED_BY_GIFT_KEY,
  forgetGiftSwitchMark,
  readGiftSwitchMark,
  type GiftSwitchMark,
} from './claudeCardsGiftMark';

export const CLAUDE_CARDS_KEY = 'claude-ai-flashcards';
export const CLAUDE_CARDS_CHANGE_EVENT = '2anki:claude-cards-change';

export type GiftPaysForAccount = boolean | 'unknown';

type GiftSwitchedKey = typeof CLAUDE_CARDS_KEY | typeof AI_CHOICE_AT_KEY;

// The account this tab has seen the gift pay for. Until it matches the
// account that claimed, the switch the claim turned on is read as if it had
// never been turned on.
let confirmedClaimer: number | null = null;

const announce = () =>
  globalThis.dispatchEvent(new Event(CLAUDE_CARDS_CHANGE_EVENT));

function valueBeforeTheGift(mark: GiftSwitchMark, key: GiftSwitchedKey) {
  return key === CLAUDE_CARDS_KEY ? mark.previous : mark.previousChoiceAt;
}

export function claudeCardsSetting(key: GiftSwitchedKey): string | null {
  const stored = globalThis.localStorage?.getItem(key) ?? null;
  const mark = readGiftSwitchMark();
  if (mark == null || mark.userId === confirmedClaimer) return stored;
  return valueBeforeTheGift(mark, key);
}

export function claudeCardsSwitchedOn(): boolean {
  return claudeCardsSetting(CLAUDE_CARDS_KEY) === 'true';
}

// Switched for a free gift, so it stays in this browser, bound to the account
// that claimed, and never reaches the account's saved settings. Setting the
// switch by hand drops the binding and syncs as before.
export function switchClaudeCardsOnForGift(claimerId: number): void {
  const store = globalThis.localStorage;
  if (store == null) return;
  const mark: GiftSwitchMark = {
    userId: claimerId,
    previous: store.getItem(CLAUDE_CARDS_KEY),
    previousChoiceAt: store.getItem(AI_CHOICE_AT_KEY),
  };
  store.setItem(CLAUDE_CARDS_SWITCHED_BY_GIFT_KEY, JSON.stringify(mark));
  store.setItem(CLAUDE_CARDS_KEY, 'true');
  store.setItem(AI_CHOICE_AT_KEY, String(Math.floor(Date.now() / 1000)));
  confirmedClaimer = claimerId;
  announce();
}

function restore(key: GiftSwitchedKey, value: string | null): void {
  if (value == null) {
    globalThis.localStorage?.removeItem(key);
  } else {
    globalThis.localStorage?.setItem(key, value);
  }
}

function stopHonouring(): void {
  if (confirmedClaimer == null) return;
  confirmedClaimer = null;
  announce();
}

// Called wherever the session and its gift are known. The switch holds only
// for the account that claimed while the gift still pays for it. A signed-out
// visitor reads the setting as it was before the claim, and the claimer gets
// the switch back on signing in again; any other account, a claimer now on a
// plan or a gift that ended puts the setting back as it was for good.
export function bindGiftClaudeSwitch(
  accountId: number | null,
  giftPays: GiftPaysForAccount
): void {
  const mark = readGiftSwitchMark();
  if (mark == null) return;
  if (accountId == null) {
    stopHonouring();
    return;
  }
  const claimer = accountId === mark.userId;
  if (claimer && giftPays === 'unknown') return;
  if (claimer && giftPays === true) {
    if (confirmedClaimer === accountId) return;
    confirmedClaimer = accountId;
    announce();
    return;
  }
  restore(CLAUDE_CARDS_KEY, mark.previous);
  restore(AI_CHOICE_AT_KEY, mark.previousChoiceAt);
  forgetGiftSwitchMark();
  confirmedClaimer = null;
  announce();
}

export function resetGiftClaudeSwitchForTests(): void {
  confirmedClaimer = null;
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

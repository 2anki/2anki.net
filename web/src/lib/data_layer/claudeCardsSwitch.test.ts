// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { AI_CHOICE_AT_KEY } from './aiChoice';
import {
  CLAUDE_CARDS_KEY,
  bindGiftClaudeSwitch,
  claudeCardsSwitchedOn,
  resetGiftClaudeSwitchForTests,
  switchClaudeCardsOnForGift,
  useClaudeCardsSwitchedOn,
} from './claudeCardsSwitch';
import { CLAUDE_CARDS_SWITCHED_BY_GIFT_KEY } from './claudeCardsGiftMark';
import { saveValueInLocalStorage } from './saveValueInLocalStorage';
import {
  cancelPendingSync,
  hydrateFromServer,
  scheduleSync,
} from './userPreferencesSync';
import { savedCardSettings } from '../upload/savedCardSettings';

const CLAIMER = 7;
const PAYING_ACCOUNT = 9;

let fetchSpy: MockInstance<typeof fetch>;
let serverPreferences: Record<string, string> = {};

const syncedCardOptions = (): Record<string, string> | undefined => {
  const call = fetchSpy.mock.calls.find(
    ([url, init]) =>
      String(url) === '/api/users/me/preferences' &&
      (init as RequestInit | undefined)?.method === 'PATCH'
  );
  if (call == null) return undefined;
  const body = JSON.parse(String((call[1] as RequestInit).body)) as {
    cardOptions?: Record<string, string>;
  };
  return body.cardOptions;
};

const flushSync = async () => {
  vi.advanceTimersByTime(600);
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetGiftClaudeSwitchForTests();
  serverPreferences = {};
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => 'token=abc',
  });
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({
      cardOptions: serverPreferences,
      theme: null,
      language: null,
      ankiWebAcknowledgedAt: null,
    })
  );
});

afterEach(() => {
  cancelPendingSync();
  fetchSpy.mockRestore();
  vi.useRealTimers();
});

describe('the Claude cards switch the gift turns on', () => {
  it('turns on in the stored setting the upload page and settings read, and records the choice', () => {
    localStorage.setItem(CLAUDE_CARDS_KEY, 'false');

    switchClaudeCardsOnForGift(CLAIMER);

    expect(claudeCardsSwitchedOn()).toBe(true);
    expect(savedCardSettings()[CLAUDE_CARDS_KEY]).toBe('true');
    expect(localStorage.getItem(AI_CHOICE_AT_KEY)).toMatch(/^\d+$/);
  });

  it('stays in this browser: no sync is sent for it', async () => {
    switchClaudeCardsOnForGift(CLAIMER);
    await flushSync();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the account’s own value, never the gift’s, when another setting syncs', async () => {
    localStorage.setItem('font-size', '20');
    localStorage.setItem(CLAUDE_CARDS_KEY, 'false');
    switchClaudeCardsOnForGift(CLAIMER);

    scheduleSync();
    await flushSync();

    expect(syncedCardOptions()).toEqual({
      'font-size': '20',
      'claude-ai-flashcards': 'false',
    });
  });

  it('syncs again once the person sets the switch by hand', async () => {
    switchClaudeCardsOnForGift(CLAIMER);

    saveValueInLocalStorage(CLAUDE_CARDS_KEY, 'true', null);
    await flushSync();

    expect(syncedCardOptions()).toMatchObject({
      'claude-ai-flashcards': 'true',
    });
  });

  it('tells a mounted reader when it turns on', () => {
    const { result } = renderHook(() => useClaudeCardsSwitchedOn());
    expect(result.current).toBe(false);

    act(() => switchClaudeCardsOnForGift(CLAIMER));

    expect(result.current).toBe(true);
  });
});

describe('the gift switch stays with the account that claimed', () => {
  beforeEach(() => {
    localStorage.setItem(CLAUDE_CARDS_KEY, 'false');
    switchClaudeCardsOnForGift(CLAIMER);
  });

  it('gives a paying account that signs in after the session ended its own setting, and leaves no automatic value', async () => {
    bindGiftClaudeSwitch(null, 'unknown');
    expect(claudeCardsSwitchedOn()).toBe(false);

    serverPreferences = { 'claude-ai-flashcards': 'false' };
    await hydrateFromServer();
    bindGiftClaudeSwitch(PAYING_ACCOUNT, false);

    expect(savedCardSettings()[CLAUDE_CARDS_KEY]).toBe('false');
    expect(localStorage.getItem(CLAUDE_CARDS_SWITCHED_BY_GIFT_KEY)).toBeNull();
  });

  it('puts the setting back for a paying account with no saved value of its own', () => {
    bindGiftClaudeSwitch(null, 'unknown');

    bindGiftClaudeSwitch(PAYING_ACCOUNT, false);

    expect(localStorage.getItem(CLAUDE_CARDS_KEY)).toBe('false');
    expect(savedCardSettings()[CLAUDE_CARDS_KEY]).toBe('false');
    expect(localStorage.getItem(CLAUDE_CARDS_SWITCHED_BY_GIFT_KEY)).toBeNull();
  });

  it('does not send the claimer’s automatic value with another account’s upload before the header has checked', () => {
    resetGiftClaudeSwitchForTests();

    expect(savedCardSettings()[CLAUDE_CARDS_KEY]).toBe('false');
    expect(claudeCardsSwitchedOn()).toBe(false);
  });

  it('lets a later account’s own Claude setting sync once it is hydrated', async () => {
    serverPreferences = { 'claude-ai-flashcards': 'true' };
    await hydrateFromServer();
    fetchSpy.mockClear();

    scheduleSync();
    await flushSync();

    expect(syncedCardOptions()).toMatchObject({
      'claude-ai-flashcards': 'true',
    });
  });

  it.each([
    ['the claimer now pays for a plan', false],
    ['the claimer’s gift expired or is used up', false],
  ])('drops the automatic value when %s', (_case, giftPays) => {
    bindGiftClaudeSwitch(CLAIMER, giftPays);

    expect(claudeCardsSwitchedOn()).toBe(false);
    expect(localStorage.getItem(CLAUDE_CARDS_KEY)).toBe('false');
    expect(localStorage.getItem(CLAUDE_CARDS_SWITCHED_BY_GIFT_KEY)).toBeNull();
  });

  it('is on again when the claimer signs back in while the gift still pays', () => {
    bindGiftClaudeSwitch(null, 'unknown');
    expect(claudeCardsSwitchedOn()).toBe(false);

    bindGiftClaudeSwitch(CLAIMER, 'unknown');
    expect(claudeCardsSwitchedOn()).toBe(false);
    bindGiftClaudeSwitch(CLAIMER, true);

    expect(claudeCardsSwitchedOn()).toBe(true);
    expect(savedCardSettings()[CLAUDE_CARDS_KEY]).toBe('true');
  });

  it('never touches a value the person set by hand', () => {
    saveValueInLocalStorage(CLAUDE_CARDS_KEY, 'true', null);

    bindGiftClaudeSwitch(PAYING_ACCOUNT, false);

    expect(localStorage.getItem(CLAUDE_CARDS_KEY)).toBe('true');
    expect(claudeCardsSwitchedOn()).toBe(true);
  });
});

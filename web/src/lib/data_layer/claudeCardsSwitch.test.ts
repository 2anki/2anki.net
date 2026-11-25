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
  claudeCardsSwitchedOn,
  switchClaudeCardsOnForThisBrowser,
  useClaudeCardsSwitchedOn,
} from './claudeCardsSwitch';
import { saveValueInLocalStorage } from './saveValueInLocalStorage';
import { cancelPendingSync, scheduleSync } from './userPreferencesSync';

let fetchSpy: MockInstance<typeof fetch>;

const syncedCardOptions = (): Record<string, string> | undefined => {
  const call = fetchSpy.mock.calls.find(
    ([url]) => String(url) === '/api/users/me/preferences'
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
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => 'token=abc',
  });
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('{}', { status: 200 }));
});

afterEach(() => {
  cancelPendingSync();
  fetchSpy.mockRestore();
  vi.useRealTimers();
});

describe('the Claude cards switch the gift turns on', () => {
  it('turns on in the stored setting the upload page and settings read, and records the choice', () => {
    localStorage.setItem(CLAUDE_CARDS_KEY, 'false');

    switchClaudeCardsOnForThisBrowser();

    expect(localStorage.getItem('claude-ai-flashcards')).toBe('true');
    expect(claudeCardsSwitchedOn()).toBe(true);
    expect(localStorage.getItem(AI_CHOICE_AT_KEY)).toMatch(/^\d+$/);
  });

  it('stays in this browser: no sync is sent for it', async () => {
    switchClaudeCardsOnForThisBrowser();
    await flushSync();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stays out of the account when another setting syncs later', async () => {
    localStorage.setItem('font-size', '20');
    switchClaudeCardsOnForThisBrowser();

    scheduleSync();
    await flushSync();

    expect(syncedCardOptions()).toEqual({ 'font-size': '20' });
  });

  it('syncs again once the person sets the switch by hand', async () => {
    switchClaudeCardsOnForThisBrowser();

    saveValueInLocalStorage(CLAUDE_CARDS_KEY, 'false', null);
    await flushSync();

    expect(syncedCardOptions()).toMatchObject({
      'claude-ai-flashcards': 'false',
    });
  });

  it('tells a mounted reader when it turns on', () => {
    const { result } = renderHook(() => useClaudeCardsSwitchedOn());
    expect(result.current).toBe(false);

    act(() => switchClaudeCardsOnForThisBrowser());

    expect(result.current).toBe(true);
  });
});

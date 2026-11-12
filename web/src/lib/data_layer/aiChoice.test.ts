// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scheduleSync = vi.fn();
vi.mock('./userPreferencesSync', () => ({
  scheduleSync: () => scheduleSync(),
}));

import {
  AI_CHOICE_AT_KEY,
  hasRecordedAiChoice,
  recordAiChoice,
} from './aiChoice';

describe('recordAiChoice', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    scheduleSync.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.localStorage.clear();
  });

  it('stores when the choice was made and syncs it to the account', () => {
    recordAiChoice();

    expect(globalThis.localStorage.getItem(AI_CHOICE_AT_KEY)).toBe(
      String(Date.parse('2026-11-12T10:00:00Z') / 1000)
    );
    expect(scheduleSync).toHaveBeenCalledTimes(1);
  });

  it('is read back as a recorded choice', () => {
    expect(hasRecordedAiChoice()).toBe(false);

    recordAiChoice();

    expect(hasRecordedAiChoice()).toBe(true);
  });
});

describe('the AI choice marker', () => {
  it('is one of the card settings that syncs across devices', async () => {
    const actual = await vi.importActual<
      typeof import('./userPreferencesSync')
    >('./userPreferencesSync');

    expect(actual.CARD_OPTION_KEYS).toContain(AI_CHOICE_AT_KEY);
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiGiftStatus } from '../../lib/backend/aiGift';
import { useActiveGiftBalance } from './useAiGiftBalanceLine';

const EXPIRES = '2026-11-26T19:15:00.000Z';

const claimed = (credits: number): AiGiftStatus => ({
  state: 'claimed',
  credits,
  expiresAt: EXPIRES,
  feedbackDue: false,
});

describe('useActiveGiftBalance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T19:13:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds the balance until the expiry time, then drops it', () => {
    const { result } = renderHook(() => useActiveGiftBalance(claimed(60)));
    expect(result.current).toEqual({ credits: 60, expiresAt: EXPIRES });

    act(() => {
      vi.advanceTimersByTime(119_999);
    });
    expect(result.current).toEqual({ credits: 60, expiresAt: EXPIRES });

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBeNull();
  });

  it('clears its expiry timer on unmount', () => {
    const { unmount } = renderHook(() => useActiveGiftBalance(claimed(60)));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['no gift', null],
    ['a closed gift', { state: 'closed', feedbackDue: false } as const],
    ['a spent gift', claimed(0)],
  ])('returns nothing and sets no timer for %s', (_name, gift) => {
    const { result } = renderHook(() => useActiveGiftBalance(gift));
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

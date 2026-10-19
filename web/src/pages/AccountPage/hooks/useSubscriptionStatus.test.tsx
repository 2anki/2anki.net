import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSubscriptionStatus } from './useSubscriptionStatus';

describe('useSubscriptionStatus', () => {
  it('names a free account when there is no plan', () => {
    const { result } = renderHook(() => useSubscriptionStatus({}, false));
    expect(result.current.plan).toBe('free');
    expect(result.current.hasActivePlan).toBe(false);
  });

  it('names a Pro subscriber without Auto Sync', () => {
    const { result } = renderHook(() =>
      useSubscriptionStatus({ subscriber: true }, false)
    );
    expect(result.current.plan).toBe('pro');
    expect(result.current.hasActivePlan).toBe(true);
  });

  it('names an Auto Sync subscriber', () => {
    const { result } = renderHook(() =>
      useSubscriptionStatus({ subscriber: true }, true)
    );
    expect(result.current.plan).toBe('autoSync');
    expect(result.current.hasActivePlan).toBe(true);
  });

  it('names a lifetime holder even when Auto Sync access is granted', () => {
    const { result } = renderHook(() =>
      useSubscriptionStatus({ patreon: true, subscriber: true }, true)
    );
    expect(result.current.plan).toBe('lifetime');
    expect(result.current.hasActivePlan).toBe(true);
  });

  it('names a Day Pass and keeps its end date', () => {
    const { result } = renderHook(() =>
      useSubscriptionStatus(
        {
          subscriber: true,
          passKind: '24h',
          passExpiresAt: '2026-11-18T00:00:00.000Z',
        },
        false
      )
    );
    expect(result.current.plan).toBe('dayPass');
    expect(result.current.passExpiresAt).toBe('2026-11-18T00:00:00.000Z');
  });

  it('names a Week Pass', () => {
    const { result } = renderHook(() =>
      useSubscriptionStatus({ subscriber: true, passKind: '7d' }, false)
    );
    expect(result.current.plan).toBe('weekPass');
  });

  it('names a Semester Pass', () => {
    const { result } = renderHook(() =>
      useSubscriptionStatus({ subscriber: true, passKind: '120d' }, false)
    );
    expect(result.current.plan).toBe('semesterPass');
  });

  it('treats an unlimited (Apple) pass as Pro, not a dated pass', () => {
    const { result } = renderHook(() =>
      useSubscriptionStatus({ subscriber: true, passKind: 'unlimited' }, false)
    );
    expect(result.current.plan).toBe('pro');
  });
});

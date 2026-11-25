import { vi } from 'vitest';
import {
  giftMarkerHeld,
  releaseGiftMarker,
  resetGiftMarkers,
  takeGiftMarker,
} from './giftConversionMarker';
import { AI_GIFT_MARKER_MAX_AGE_MS } from './giftTerms';

beforeEach(() => {
  resetGiftMarkers();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-25T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the gift marker', () => {
  it('lets one conversion per account hold it', () => {
    const first = takeGiftMarker(9);

    expect(first).not.toBeNull();
    expect(takeGiftMarker(9)).toBeNull();
    expect(takeGiftMarker(10)).not.toBeNull();
  });

  it('is free again once released', () => {
    releaseGiftMarker(takeGiftMarker(9));

    expect(takeGiftMarker(9)).not.toBeNull();
  });

  it('can be taken over once it is older than the longest a conversion runs', () => {
    takeGiftMarker(9);

    vi.advanceTimersByTime(AI_GIFT_MARKER_MAX_AGE_MS - 1);
    expect(takeGiftMarker(9)).toBeNull();

    vi.advanceTimersByTime(1);
    expect(takeGiftMarker(9)).not.toBeNull();
  });

  it('tells whether a conversion holds it, until it is released or too old', () => {
    expect(giftMarkerHeld(9)).toBe(false);
    const marker = takeGiftMarker(9);
    expect(giftMarkerHeld(9)).toBe(true);
    expect(giftMarkerHeld(10)).toBe(false);

    releaseGiftMarker(marker);
    expect(giftMarkerHeld(9)).toBe(false);

    takeGiftMarker(9);
    vi.advanceTimersByTime(AI_GIFT_MARKER_MAX_AGE_MS);
    expect(giftMarkerHeld(9)).toBe(false);
  });

  it('is not cleared by a conversion that outlived it and finishes later', () => {
    const stale = takeGiftMarker(9);
    vi.advanceTimersByTime(AI_GIFT_MARKER_MAX_AGE_MS);
    const current = takeGiftMarker(9);

    releaseGiftMarker(stale);

    expect(current).not.toBeNull();
    expect(takeGiftMarker(9)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { formatLongDate } from './formatLongDate';

describe('formatLongDate', () => {
  it('formats a date as a long day, month and year for the given locale', () => {
    const date = new Date('2026-05-12T00:00:00.000Z');
    expect(formatLongDate(date, 'en-US')).toBe('May 12, 2026');
  });
});

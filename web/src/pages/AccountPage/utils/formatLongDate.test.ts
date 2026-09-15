import { describe, expect, it } from 'vitest';
import { formatLongDate } from './formatLongDate';

describe('formatLongDate', () => {
  it('formats a date as a long day, month and year for the given locale', () => {
    const date = new Date('2026-05-12T12:00:00.000Z');
    expect(formatLongDate(date, 'en-US')).toBe('May 12, 2026');
  });

  it('keeps a UTC-midnight boundary on the same day when formatted in UTC', () => {
    const date = new Date('2026-06-01T00:00:00.000Z');
    expect(formatLongDate(date, 'en-US', 'UTC')).toBe('June 1, 2026');
  });
});

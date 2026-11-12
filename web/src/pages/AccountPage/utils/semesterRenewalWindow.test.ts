import { describe, expect, it } from 'vitest';
import {
  SEMESTER_RENEWAL_WINDOW_MS,
  semesterRenewalDaysLeft,
} from './semesterRenewalWindow';

const NOW = new Date('2027-01-10T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe('semesterRenewalDaysLeft', () => {
  it.each([
    ['one hour left', iso(HOUR_MS), 1],
    ['three and a half days left', iso(84 * HOUR_MS), 4],
    ['exactly seven days left', iso(SEMESTER_RENEWAL_WINDOW_MS), 7],
  ])(
    'returns the rounded-up days for a Semester Pass with %s',
    (_label, expiresAt, days) => {
      expect(semesterRenewalDaysLeft('120d', expiresAt, NOW)).toBe(days);
    }
  );

  it.each([
    ['more than seven days left', iso(SEMESTER_RENEWAL_WINDOW_MS + 60_000)],
    ['already ended', iso(-HOUR_MS)],
    ['an unreadable date', 'not-a-date'],
  ])('returns null for a Semester Pass with %s', (_label, expiresAt) => {
    expect(semesterRenewalDaysLeft('120d', expiresAt, NOW)).toBeNull();
  });

  it.each(['24h', '7d', 'unlimited'] as const)(
    'returns null for a %s pass in its final week',
    (kind) => {
      expect(semesterRenewalDaysLeft(kind, iso(HOUR_MS), NOW)).toBeNull();
    }
  );

  it('returns null without a pass', () => {
    expect(semesterRenewalDaysLeft(null, null, NOW)).toBeNull();
  });
});

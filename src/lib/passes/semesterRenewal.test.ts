import {
  SEMESTER_RENEWAL_WINDOW_MS,
  isInSemesterRenewalWindow,
} from './semesterRenewal';

const NOW = new Date('2027-01-10T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const inMs = (ms: number) => new Date(NOW.getTime() + ms);

describe('isInSemesterRenewalWindow', () => {
  it.each([
    ['one hour left', inMs(HOUR_MS)],
    ['three days left', inMs(72 * HOUR_MS)],
    ['exactly seven days left', inMs(SEMESTER_RENEWAL_WINDOW_MS)],
  ])('opens for a Semester Pass with %s', (_label, expiresAt) => {
    expect(isInSemesterRenewalWindow('120d', expiresAt, NOW)).toBe(true);
  });

  it.each([
    ['seven days and a minute left', inMs(SEMESTER_RENEWAL_WINDOW_MS + 60_000)],
    ['already ended', inMs(-HOUR_MS)],
    ['ending this instant', NOW],
  ])('stays closed for a Semester Pass with %s', (_label, expiresAt) => {
    expect(isInSemesterRenewalWindow('120d', expiresAt, NOW)).toBe(false);
  });

  it.each(['24h', '7d', 'unlimited'] as const)(
    'stays closed for a %s pass in its final week',
    (kind) => {
      expect(isInSemesterRenewalWindow(kind, inMs(HOUR_MS), NOW)).toBe(false);
    }
  );

  it('stays closed without a pass', () => {
    expect(isInSemesterRenewalWindow(null, null, NOW)).toBe(false);
  });
});

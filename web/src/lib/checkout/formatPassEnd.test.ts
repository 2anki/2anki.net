import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatPassEnd } from './formatPassEnd';

const LATE_EVENING_UTC = '2027-01-10T23:30:00.000Z';
const JUST_AFTER_MIDNIGHT_UTC = '2027-01-11T00:30:00.000Z';

describe('formatPassEnd', () => {
  let originalZone: string | undefined;

  beforeEach(() => {
    originalZone = process.env.TZ;
  });

  afterEach(() => {
    process.env.TZ = originalZone;
  });

  it.each([
    ['Europe/Berlin', LATE_EVENING_UTC, 'January 11, 2027 at 12:30 AM'],
    ['Europe/Berlin', JUST_AFTER_MIDNIGHT_UTC, 'January 11, 2027 at 01:30 AM'],
    ['America/New_York', LATE_EVENING_UTC, 'January 10, 2027 at 06:30 PM'],
    [
      'America/New_York',
      JUST_AFTER_MIDNIGHT_UTC,
      'January 10, 2027 at 07:30 PM',
    ],
  ])(
    'writes the end in the viewer zone %s with its time, %s as %s',
    (zone, iso, expected) => {
      process.env.TZ = zone;

      expect(formatPassEnd(iso, 'en')).toBe(expected);
    }
  );

  it('writes the end in German for a German reader', () => {
    process.env.TZ = 'Europe/Berlin';

    expect(formatPassEnd(LATE_EVENING_UTC, 'de')).toBe(
      '11. Januar 2027 um 00:30'
    );
  });

  it('returns null for a value that is not a date', () => {
    expect(formatPassEnd('soon', 'en')).toBeNull();
  });
});

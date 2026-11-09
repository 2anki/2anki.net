import { describe, expect, it } from 'vitest';
import {
  readPageRangeDetails,
  readTooLongSetting,
} from './readUploadErrorDetails';

describe('readPageRangeDetails', () => {
  it.each([
    [{ reason: 'too_long', max: 200 }],
    [{ reason: 'too_many_parts', max: 50 }],
    [{ reason: 'number_too_large', part: '1234567' }],
    [{ reason: 'range_starts_at_zero', part: '0-3' }],
    [{ reason: 'backwards', part: '30-12', lower: 12, upper: 30 }],
    [{ reason: 'page_zero', part: '0' }],
    [{ reason: 'invalid_part', part: 'abc' }],
    [{ reason: 'past_end', first: 11, last: 14, pageCount: 10 }],
    [{ reason: 'locked_pdf' }],
    [{ reason: 'split_timeout' }],
  ])('keeps %o', (details) => {
    expect(readPageRangeDetails(details)).toEqual(details);
  });

  it('drops anything but the shape fields', () => {
    expect(
      readPageRangeDetails({ reason: 'locked_pdf', extra: '<b>' })
    ).toEqual({ reason: 'locked_pdf' });
  });

  it.each([
    ['nothing', undefined],
    ['text', 'backwards'],
    ['an unknown reason', { reason: 'toString' }],
    ['a negative limit', { reason: 'too_long', max: -1 }],
    [
      'a fractional page',
      { reason: 'past_end', first: 1.5, last: 2, pageCount: 1 },
    ],
    ['a part that is a number', { reason: 'page_zero', part: 0 }],
  ])('drops %s', (_case, value) => {
    expect(readPageRangeDetails(value)).toBeUndefined();
  });
});

describe('readTooLongSetting', () => {
  it.each(['user_instructions', 'deck_name'])('keeps %s', (setting) => {
    expect(readTooLongSetting(setting)).toBe(setting);
  });

  it.each(['theme', 'toString', 7, undefined])('drops %s', (value) => {
    expect(readTooLongSetting(value)).toBeUndefined();
  });
});

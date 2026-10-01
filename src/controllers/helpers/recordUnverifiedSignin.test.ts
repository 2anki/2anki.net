jest.mock('../../services/events/track', () => ({
  track: jest.fn(),
}));

import { track } from '../../services/events/track';
import {
  accountAgeBucket,
  recordUnverifiedSignin,
} from './recordUnverifiedSignin';

const trackMock = track as jest.Mock;
const NOW = new Date('2026-10-01T12:00:00.000Z');

describe('accountAgeBucket', () => {
  it.each([
    [new Date('2026-10-01T11:30:00.000Z'), 'under_1h'],
    [new Date('2026-10-01T10:59:59.000Z'), '1h_to_30d'],
    [new Date('2026-09-01T12:00:01.000Z'), '1h_to_30d'],
    [new Date('2026-08-01T00:00:00.000Z'), 'over_30d'],
    ['2026-10-01T11:59:00.000Z', 'under_1h'],
    [null, 'unknown'],
    ['not a date', 'unknown'],
  ])('buckets %p as %s', (createdAt, bucket) => {
    expect(accountAgeBucket(createdAt, NOW)).toBe(bucket);
  });
});

describe('recordUnverifiedSignin', () => {
  beforeEach(() => trackMock.mockClear());

  it('records a sign-in onto an existing unverified account', () => {
    recordUnverifiedSignin(
      {
        id: 42,
        email_verified: false,
        created_at: new Date('2026-08-01T00:00:00.000Z'),
      },
      'google',
      NOW
    );

    expect(trackMock).toHaveBeenCalledWith('unverified_account_signin', {
      userId: 42,
      props: { surface: 'google', account_age: 'over_30d' },
    });
  });

  it('records nothing for a verified account', () => {
    recordUnverifiedSignin(
      { id: 42, email_verified: true, created_at: null },
      'notion',
      NOW
    );

    expect(trackMock).not.toHaveBeenCalled();
  });
});

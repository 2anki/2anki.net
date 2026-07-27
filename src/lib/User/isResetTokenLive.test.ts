import { isResetTokenLive } from './isResetTokenLive';

const now = new Date('2026-07-27T12:00:00.000Z');

describe('isResetTokenLive', () => {
  it('is live while inside the window and unused', () => {
    expect(
      isResetTokenLive(
        {
          reset_token_expires_at: new Date('2026-07-27T12:10:00.000Z'),
          reset_token_used_at: null,
        },
        now
      )
    ).toBe(true);
  });

  it('is not live once the window has passed', () => {
    expect(
      isResetTokenLive(
        {
          reset_token_expires_at: new Date('2026-07-27T11:59:59.000Z'),
          reset_token_used_at: null,
        },
        now
      )
    ).toBe(false);
  });

  it('is not live once redeemed', () => {
    expect(
      isResetTokenLive(
        {
          reset_token_expires_at: new Date('2026-07-27T12:10:00.000Z'),
          reset_token_used_at: new Date('2026-07-27T11:55:00.000Z'),
        },
        now
      )
    ).toBe(false);
  });

  // Rows written before the expiry column existed: treat as dead so the user
  // is issued a fresh token instead of being emailed an unusable link.
  it('is not live when the expiry is missing', () => {
    expect(isResetTokenLive({ reset_token_expires_at: null }, now)).toBe(false);
    expect(isResetTokenLive({}, now)).toBe(false);
  });

  it('accepts a timestamp string from the driver', () => {
    expect(
      isResetTokenLive(
        { reset_token_expires_at: '2026-07-27T12:10:00.000Z' },
        now
      )
    ).toBe(true);
  });

  it('is not live for an unparseable expiry', () => {
    expect(isResetTokenLive({ reset_token_expires_at: 'nonsense' }, now)).toBe(
      false
    );
  });
});

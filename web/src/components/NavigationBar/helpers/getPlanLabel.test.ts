import { describe, expect, it } from 'vitest';
import { getPlanLabel, isPayingUser } from './getPlanLabel';

describe('getPlanLabel', () => {
  it('returns Lifetime when locals.patreon is true', () => {
    expect(getPlanLabel({ patreon: true })).toBe('Lifetime');
  });

  it('returns Pro when only subscriber is true', () => {
    expect(getPlanLabel({ subscriber: true })).toBe('Pro');
  });

  it('prefers Lifetime when both flags are true', () => {
    expect(getPlanLabel({ patreon: true, subscriber: true })).toBe('Lifetime');
  });

  it('returns Free when neither flag is set', () => {
    expect(getPlanLabel({})).toBe('Free');
  });

  it('returns Free for null locals', () => {
    expect(getPlanLabel(null)).toBe('Free');
  });

  it('returns Free for undefined locals', () => {
    expect(getPlanLabel(undefined)).toBe('Free');
  });
});

describe('isPayingUser', () => {
  it('is true for patreon', () => {
    expect(isPayingUser({ patreon: true })).toBe(true);
  });

  it('is true for subscriber', () => {
    expect(isPayingUser({ subscriber: true })).toBe(true);
  });

  it('is false for neither', () => {
    expect(isPayingUser({})).toBe(false);
  });

  it('is false for null', () => {
    expect(isPayingUser(null)).toBe(false);
  });
});

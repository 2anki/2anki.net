import { describe, expect, it } from 'vitest';
import { mayHaveLapsedPayment } from './useLapsedPayment';

const onRecord = { subscriptionInfo: { email: 'payer@example.com' } };

describe('mayHaveLapsedPayment', () => {
  it('is true for a non-paying account with a subscription on record', () => {
    expect(
      mayHaveLapsedPayment({ subscriber: false, patreon: false, ...onRecord })
    ).toBe(true);
  });

  it.each([
    ['a signed-out visitor', undefined],
    ['an empty read', null],
    ['someone who has never paid', { subscriber: false, patreon: false }],
    ['an empty subscription record', { subscriptionInfo: {} }],
    ['a subscriber', { subscriber: true, ...onRecord }],
    [
      'a pass or Apple holder with a lapsed plan',
      { subscriber: true, ...onRecord },
    ],
    ['a lifetime holder', { patreon: true, ...onRecord }],
  ])('is false for %s', (_who, locals) => {
    expect(mayHaveLapsedPayment(locals)).toBe(false);
  });
});

import {
  isStripeAccessError,
  stripeAccessErrorType,
} from './isStripeAccessError';

function stripeError(type: string): Error {
  return Object.assign(new Error('stripe says no'), { type, statusCode: 403 });
}

describe('isStripeAccessError', () => {
  it('matches a StripePermissionError by its type', () => {
    expect(isStripeAccessError(stripeError('StripePermissionError'))).toBe(
      true
    );
  });

  it('matches a StripeAuthenticationError by its type', () => {
    expect(isStripeAccessError(stripeError('StripeAuthenticationError'))).toBe(
      true
    );
  });

  it('matches when only the error name carries the Stripe class', () => {
    const err = Object.assign(new Error('stripe says no'), {
      name: 'StripePermissionError',
    });
    expect(isStripeAccessError(err)).toBe(true);
  });

  it('ignores a non-access Stripe error such as a rate limit', () => {
    expect(isStripeAccessError(stripeError('StripeRateLimitError'))).toBe(
      false
    );
  });

  it('ignores a card error', () => {
    expect(isStripeAccessError(stripeError('StripeCardError'))).toBe(false);
  });

  it('ignores a plain error and nullish input', () => {
    expect(isStripeAccessError(new Error('boom'))).toBe(false);
    expect(isStripeAccessError(undefined)).toBe(false);
    expect(isStripeAccessError(null)).toBe(false);
  });
});

describe('stripeAccessErrorType', () => {
  it('returns the matched type', () => {
    expect(stripeAccessErrorType(stripeError('StripePermissionError'))).toBe(
      'StripePermissionError'
    );
  });

  it('returns null for a non-access error', () => {
    expect(
      stripeAccessErrorType(stripeError('StripeRateLimitError'))
    ).toBeNull();
  });
});

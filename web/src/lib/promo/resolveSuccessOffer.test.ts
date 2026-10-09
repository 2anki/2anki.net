import { describe, expect, it } from 'vitest';

import { resolveSuccessOffer } from './resolveSuccessOffer';

describe('resolveSuccessOffer', () => {
  it('offers account creation to anonymous users', () => {
    expect(resolveSuccessOffer({ anonymous: true })).toBe('anon_signup');
  });

  it('offers a verified signed-in user nothing', () => {
    expect(
      resolveSuccessOffer({ anonymous: false, emailVerified: true })
    ).toBeNull();
  });

  it('offers a signed-in user with an unverified email the confirm card', () => {
    expect(
      resolveSuccessOffer({ anonymous: false, emailVerified: false })
    ).toBe('confirm_email');
  });

  it('offers nothing when verification status is unknown', () => {
    expect(resolveSuccessOffer({ anonymous: false })).toBeNull();
  });

  it('keeps the anonymous offer exclusive of the confirm card', () => {
    expect(resolveSuccessOffer({ anonymous: true, emailVerified: false })).toBe(
      'anon_signup'
    );
  });
});

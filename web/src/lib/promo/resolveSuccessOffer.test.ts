import { describe, expect, it } from 'vitest';

import { resolveSuccessOffer } from './resolveSuccessOffer';

describe('resolveSuccessOffer', () => {
  it('offers account creation to anonymous users', () => {
    expect(
      resolveSuccessOffer({
        anonymous: true,
        paying: false,
      })
    ).toBe('anon_signup');
  });

  it('shows nothing to paying users', () => {
    expect(
      resolveSuccessOffer({
        anonymous: false,
        paying: true,
      })
    ).toBeNull();
  });

  it('falls back to the pass upsell for logged-in free users', () => {
    expect(
      resolveSuccessOffer({
        anonymous: false,
        paying: false,
      })
    ).toBe('upsell');
  });
});

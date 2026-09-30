import { describe, expect, it } from 'vitest';

import { resolveSuccessOffer } from './resolveSuccessOffer';

describe('resolveSuccessOffer', () => {
  it('offers account creation to anonymous users', () => {
    expect(resolveSuccessOffer({ anonymous: true })).toBe('anon_signup');
  });

  it('offers a signed-in user nothing, paying or not', () => {
    expect(resolveSuccessOffer({ anonymous: false })).toBeNull();
  });
});

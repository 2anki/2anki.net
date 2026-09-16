import { beforeEach, describe, expect, it, vi } from 'vitest';

const startCreditPackCheckout_ = vi.fn();

vi.mock('./get2ankiApi', () => ({
  get2ankiApi: () => ({ startCreditPackCheckout: startCreditPackCheckout_ }),
}));

import { startCreditPackCheckout } from './startCreditPackCheckout';

function stubLocation() {
  const location = { href: '' };
  vi.stubGlobal('location', location);
  return location;
}

describe('startCreditPackCheckout', () => {
  beforeEach(() => {
    startCreditPackCheckout_.mockReset();
    vi.unstubAllGlobals();
  });

  it('redirects to the Stripe session created through the API', async () => {
    startCreditPackCheckout_.mockResolvedValue({ url: 'https://stripe/pack' });
    const location = stubLocation();

    const outcome = await startCreditPackCheckout('credits_account');

    expect(startCreditPackCheckout_).toHaveBeenCalledWith('credits_account');
    expect(location.href).toBe('https://stripe/pack');
    expect(outcome).toBe('redirecting');
  });

  it('reports the error status without redirecting when the session fails', async () => {
    startCreditPackCheckout_.mockResolvedValue({ status: 'error' });
    const location = stubLocation();

    const outcome = await startCreditPackCheckout('credits_badge');

    expect(location.href).toBe('');
    expect(outcome).toBe('error');
  });

  it('surfaces an unavailable pack so the caller can hide the affordance', async () => {
    startCreditPackCheckout_.mockResolvedValue({ status: 'unavailable' });
    stubLocation();

    const outcome = await startCreditPackCheckout('credits_conversion');

    expect(outcome).toBe('unavailable');
  });
});

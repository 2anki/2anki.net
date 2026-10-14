// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCheckoutReceipt = vi.fn();
const firePurchaseConversion = vi.fn();

vi.mock('../backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ getCheckoutReceipt }),
}));
vi.mock('./googleAds', () => ({
  firePurchaseConversion: (...args: unknown[]) =>
    firePurchaseConversion(...args),
}));

import { reportPurchaseConversion } from './reportPurchaseConversion';

const receipt = {
  amount: 600,
  currency: 'USD',
  kind: 'pass_24h',
  anonymous: false,
};

beforeEach(() => {
  sessionStorage.clear();
  firePurchaseConversion.mockReturnValue(true);
});

afterEach(() => {
  getCheckoutReceipt.mockReset();
  firePurchaseConversion.mockReset();
});

describe('reportPurchaseConversion', () => {
  it('fetches the receipt and fires the conversion with the owner email', async () => {
    getCheckoutReceipt.mockResolvedValue(receipt);

    await reportPurchaseConversion('cs_test_1', 'a@b.test');

    expect(getCheckoutReceipt).toHaveBeenCalledWith('cs_test_1');
    expect(firePurchaseConversion).toHaveBeenCalledWith({
      sessionId: 'cs_test_1',
      amountCents: 600,
      currency: 'USD',
      kind: 'pass_24h',
      email: 'a@b.test',
    });
  });

  it('never attaches an email to an anonymous pass receipt', async () => {
    getCheckoutReceipt.mockResolvedValue({ ...receipt, anonymous: true });

    await reportPurchaseConversion('cs_test_anon', 'a@b.test');

    expect(firePurchaseConversion).toHaveBeenCalledWith(
      expect.objectContaining({ email: null })
    );
  });

  it('does nothing when the server has no receipt for the session', async () => {
    getCheckoutReceipt.mockResolvedValue(null);

    await reportPurchaseConversion('cs_test_2');

    expect(firePurchaseConversion).not.toHaveBeenCalled();
  });

  it('reports a session once after a successful send', async () => {
    getCheckoutReceipt.mockResolvedValue(receipt);

    await reportPurchaseConversion('cs_test_3');
    await reportPurchaseConversion('cs_test_3');

    expect(getCheckoutReceipt).toHaveBeenCalledTimes(1);
  });

  it('retries later when nothing was sent (consent not yet granted)', async () => {
    getCheckoutReceipt.mockResolvedValue(receipt);
    firePurchaseConversion.mockReturnValueOnce(false);

    await reportPurchaseConversion('cs_test_4');
    await reportPurchaseConversion('cs_test_4');

    expect(getCheckoutReceipt).toHaveBeenCalledTimes(2);
    expect(firePurchaseConversion).toHaveBeenCalledTimes(2);
  });
});

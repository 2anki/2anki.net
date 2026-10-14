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

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  getCheckoutReceipt.mockReset();
  firePurchaseConversion.mockReset();
});

describe('reportPurchaseConversion', () => {
  it('fetches the receipt and fires the conversion with it', async () => {
    getCheckoutReceipt.mockResolvedValue({
      amount: 600,
      currency: 'USD',
      kind: 'pass_24h',
    });

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

  it('does nothing when the server has no receipt for the session', async () => {
    getCheckoutReceipt.mockResolvedValue(null);

    await reportPurchaseConversion('cs_test_2');

    expect(firePurchaseConversion).not.toHaveBeenCalled();
  });

  it('asks the server once per session', async () => {
    getCheckoutReceipt.mockResolvedValue({
      amount: 600,
      currency: 'USD',
      kind: 'pass_24h',
    });

    await reportPurchaseConversion('cs_test_3');
    await reportPurchaseConversion('cs_test_3');

    expect(getCheckoutReceipt).toHaveBeenCalledTimes(1);
  });
});

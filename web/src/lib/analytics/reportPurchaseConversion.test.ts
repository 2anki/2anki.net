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

import {
  replayPendingPurchaseConversions,
  reportPurchaseConversion,
} from './reportPurchaseConversion';
import { CONSENT_CHANGE_EVENT } from '../consent/consent';

const receipt = {
  amount: 600,
  currency: 'USD',
  kind: 'pass_24h',
  anonymous: false,
};

const ok = { status: 'ok' as const, receipt };
const PENDING_PREFIX = 'ads_purchase_pending:';

const purchaseFor = (sessionId: string, email: string | null = 'a@b.test') => ({
  sessionId,
  amountCents: 600,
  currency: 'USD',
  kind: 'pass_24h',
  email,
});

const grant = () => {
  document.cookie = 'cookie_consent=granted';
  globalThis.dispatchEvent(
    new CustomEvent(CONSENT_CHANGE_EVENT, { detail: 'granted' })
  );
  document.cookie = 'cookie_consent=; Max-Age=0';
};

beforeEach(() => {
  sessionStorage.clear();
  firePurchaseConversion.mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  getCheckoutReceipt.mockReset();
  firePurchaseConversion.mockReset();
  document.cookie = 'cookie_consent=; Max-Age=0';
});

describe('reportPurchaseConversion', () => {
  it('fetches the receipt and fires the conversion with the owner email', async () => {
    getCheckoutReceipt.mockResolvedValue(ok);

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
    getCheckoutReceipt.mockResolvedValue({
      status: 'ok',
      receipt: { ...receipt, anonymous: true },
    });

    await reportPurchaseConversion('cs_test_anon', 'a@b.test');

    expect(firePurchaseConversion).toHaveBeenCalledWith(
      expect.objectContaining({ email: null })
    );
  });

  it('does nothing when the server has no receipt for the session', async () => {
    getCheckoutReceipt.mockResolvedValue({ status: 'not_found' });

    await reportPurchaseConversion('cs_test_2');

    expect(firePurchaseConversion).not.toHaveBeenCalled();
  });

  it('reports a session once after a successful send', async () => {
    getCheckoutReceipt.mockResolvedValue(ok);

    await reportPurchaseConversion('cs_test_3');
    await reportPurchaseConversion('cs_test_3');

    expect(getCheckoutReceipt).toHaveBeenCalledTimes(1);
  });

  it('retries later when nothing was sent (consent not yet granted)', async () => {
    getCheckoutReceipt.mockResolvedValue(ok);
    firePurchaseConversion.mockReturnValueOnce(false);

    await reportPurchaseConversion('cs_test_4');
    await reportPurchaseConversion('cs_test_4');

    expect(getCheckoutReceipt).toHaveBeenCalledTimes(2);
    expect(firePurchaseConversion).toHaveBeenCalledTimes(2);
  });

  it('sends a held purchase when consent is really granted later, without a second lookup', async () => {
    getCheckoutReceipt.mockResolvedValue(ok);
    firePurchaseConversion.mockReturnValueOnce(false);

    await reportPurchaseConversion('cs_test_held', 'a@b.test');
    expect(firePurchaseConversion).toHaveBeenCalledTimes(1);

    globalThis.dispatchEvent(
      new CustomEvent(CONSENT_CHANGE_EVENT, { detail: 'granted' })
    );
    expect(firePurchaseConversion).toHaveBeenCalledTimes(1);

    grant();
    expect(firePurchaseConversion).toHaveBeenCalledTimes(2);
    expect(firePurchaseConversion).toHaveBeenLastCalledWith(
      purchaseFor('cs_test_held')
    );
    expect(getCheckoutReceipt).toHaveBeenCalledTimes(1);

    await reportPurchaseConversion('cs_test_held');
    expect(getCheckoutReceipt).toHaveBeenCalledTimes(1);
  });
});

describe('reportPurchaseConversion receipt retry', () => {
  it('retries a transient lookup failure, then reports once it succeeds', async () => {
    vi.useFakeTimers();
    getCheckoutReceipt
      .mockResolvedValueOnce({ status: 'transient' })
      .mockResolvedValueOnce(ok);

    const pending = reportPurchaseConversion('cs_retry', 'a@b.test');
    await vi.advanceTimersByTimeAsync(2000);
    await pending;

    expect(getCheckoutReceipt).toHaveBeenCalledTimes(2);
    expect(firePurchaseConversion).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'cs_retry', email: 'a@b.test' })
    );
  });

  it('gives up after exhausting the transient retries without reporting', async () => {
    vi.useFakeTimers();
    getCheckoutReceipt.mockResolvedValue({ status: 'transient' });

    const pending = reportPurchaseConversion('cs_down');
    await vi.advanceTimersByTimeAsync(5000);
    await pending;

    expect(getCheckoutReceipt).toHaveBeenCalledTimes(3);
    expect(firePurchaseConversion).not.toHaveBeenCalled();
  });

  it('never retries a not-found receipt', async () => {
    getCheckoutReceipt.mockResolvedValue({ status: 'not_found' });

    await reportPurchaseConversion('cs_missing');

    expect(getCheckoutReceipt).toHaveBeenCalledTimes(1);
    expect(firePurchaseConversion).not.toHaveBeenCalled();
  });
});

describe('reportPurchaseConversion held-purchase persistence', () => {
  it('persists a held purchase so a reload can replay it', async () => {
    getCheckoutReceipt.mockResolvedValue(ok);
    firePurchaseConversion.mockReturnValueOnce(false);

    await reportPurchaseConversion('cs_hold', 'a@b.test');

    const stored = sessionStorage.getItem(`${PENDING_PREFIX}cs_hold`);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual(purchaseFor('cs_hold'));

    globalThis.dispatchEvent(
      new CustomEvent(CONSENT_CHANGE_EVENT, { detail: 'denied' })
    );
    expect(sessionStorage.getItem(`${PENDING_PREFIX}cs_hold`)).toBeNull();
  });

  it('drops a held purchase when the visitor denies consent', async () => {
    getCheckoutReceipt.mockResolvedValue(ok);
    firePurchaseConversion.mockReturnValueOnce(false);

    await reportPurchaseConversion('cs_deny', 'a@b.test');
    expect(sessionStorage.getItem(`${PENDING_PREFIX}cs_deny`)).not.toBeNull();

    globalThis.dispatchEvent(
      new CustomEvent(CONSENT_CHANGE_EVENT, { detail: 'denied' })
    );
    expect(sessionStorage.getItem(`${PENDING_PREFIX}cs_deny`)).toBeNull();

    grant();
    expect(firePurchaseConversion).toHaveBeenCalledTimes(1);
  });

  it('replays a persisted pending purchase after a reload once consent is granted', () => {
    sessionStorage.setItem(
      `${PENDING_PREFIX}cs_reload`,
      JSON.stringify(purchaseFor('cs_reload'))
    );
    document.cookie = 'cookie_consent=granted';

    replayPendingPurchaseConversions();

    expect(getCheckoutReceipt).not.toHaveBeenCalled();
    expect(firePurchaseConversion).toHaveBeenCalledWith(
      purchaseFor('cs_reload')
    );
    expect(sessionStorage.getItem(`${PENDING_PREFIX}cs_reload`)).toBeNull();
    document.cookie = 'cookie_consent=; Max-Age=0';
  });

  it('replays a persisted pending purchase that is still waiting for consent', () => {
    sessionStorage.setItem(
      `${PENDING_PREFIX}cs_reload_wait`,
      JSON.stringify(purchaseFor('cs_reload_wait'))
    );

    replayPendingPurchaseConversions();
    expect(firePurchaseConversion).not.toHaveBeenCalled();

    grant();
    expect(firePurchaseConversion).toHaveBeenCalledWith(
      purchaseFor('cs_reload_wait')
    );
  });

  it('does not replay a purchase that was already reported', () => {
    sessionStorage.setItem('ads_purchase_reported:cs_done', '1');
    sessionStorage.setItem(
      `${PENDING_PREFIX}cs_done`,
      JSON.stringify(purchaseFor('cs_done'))
    );
    document.cookie = 'cookie_consent=granted';

    replayPendingPurchaseConversions();

    expect(firePurchaseConversion).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`${PENDING_PREFIX}cs_done`)).toBeNull();
    document.cookie = 'cookie_consent=; Max-Age=0';
  });
});

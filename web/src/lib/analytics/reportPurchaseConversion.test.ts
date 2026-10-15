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
const buyer = { id: 7, email: 'a@b.test' };

const purchaseFor = (sessionId: string, email: string | null = 'a@b.test') => ({
  sessionId,
  amountCents: 600,
  currency: 'USD',
  kind: 'pass_24h',
  email,
});

const pendingFor = (sessionId: string, ownerId: number | null = 7) => ({
  sessionId,
  amountCents: 600,
  currency: 'USD',
  kind: 'pass_24h',
  ownerId,
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

    await reportPurchaseConversion('cs_test_1', buyer);

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

    await reportPurchaseConversion('cs_test_anon', buyer);

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

    await reportPurchaseConversion('cs_test_held', buyer);
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

    const pending = reportPurchaseConversion('cs_retry', buyer);
    await vi.advanceTimersByTimeAsync(299);
    expect(getCheckoutReceipt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
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
    await vi.advanceTimersByTimeAsync(300);
    expect(getCheckoutReceipt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(599);
    expect(getCheckoutReceipt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
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

    await reportPurchaseConversion('cs_hold', buyer);

    const stored = sessionStorage.getItem(`${PENDING_PREFIX}cs_hold`);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual(pendingFor('cs_hold'));
    expect(stored).not.toContain('a@b.test');

    globalThis.dispatchEvent(
      new CustomEvent(CONSENT_CHANGE_EVENT, { detail: 'denied' })
    );
    expect(sessionStorage.getItem(`${PENDING_PREFIX}cs_hold`)).toBeNull();
  });

  it('drops a held purchase when the visitor denies consent', async () => {
    getCheckoutReceipt.mockResolvedValue(ok);
    firePurchaseConversion.mockReturnValueOnce(false);

    await reportPurchaseConversion('cs_deny', buyer);
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
      JSON.stringify(pendingFor('cs_reload'))
    );
    document.cookie = 'cookie_consent=granted';

    replayPendingPurchaseConversions(buyer);

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
      JSON.stringify(pendingFor('cs_reload_wait'))
    );

    replayPendingPurchaseConversions(buyer);
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
      JSON.stringify(pendingFor('cs_done'))
    );
    document.cookie = 'cookie_consent=granted';

    replayPendingPurchaseConversions(buyer);

    expect(firePurchaseConversion).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`${PENDING_PREFIX}cs_done`)).toBeNull();
    document.cookie = 'cookie_consent=; Max-Age=0';
  });

  it('replays an anonymous pending purchase without the signed-in email', () => {
    sessionStorage.setItem(
      `${PENDING_PREFIX}cs_anon`,
      JSON.stringify(pendingFor('cs_anon', null))
    );
    document.cookie = 'cookie_consent=granted';

    replayPendingPurchaseConversions(buyer);

    expect(firePurchaseConversion).toHaveBeenCalledWith(
      purchaseFor('cs_anon', null)
    );
    document.cookie = 'cookie_consent=; Max-Age=0';
  });

  it('clears persisted pending purchases on replay after an explicit denial', () => {
    sessionStorage.setItem(
      `${PENDING_PREFIX}cs_denied`,
      JSON.stringify(pendingFor('cs_denied'))
    );
    document.cookie = 'cookie_consent=denied';

    replayPendingPurchaseConversions(buyer);

    expect(firePurchaseConversion).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`${PENDING_PREFIX}cs_denied`)).toBeNull();
  });

  it('sweeps a persisted pending purchase that was never replayed when consent is denied', async () => {
    getCheckoutReceipt.mockResolvedValue(ok);
    firePurchaseConversion.mockReturnValueOnce(false);
    await reportPurchaseConversion('cs_live', buyer);
    sessionStorage.setItem(
      `${PENDING_PREFIX}cs_elsewhere`,
      JSON.stringify(pendingFor('cs_elsewhere'))
    );

    globalThis.dispatchEvent(
      new CustomEvent(CONSENT_CHANGE_EVENT, { detail: 'denied' })
    );

    expect(sessionStorage.getItem(`${PENDING_PREFIX}cs_live`)).toBeNull();
    expect(sessionStorage.getItem(`${PENDING_PREFIX}cs_elsewhere`)).toBeNull();
  });

  it('drops a corrupt persisted entry instead of re-parsing it every replay', () => {
    sessionStorage.setItem(`${PENDING_PREFIX}cs_corrupt`, '{not json');
    document.cookie = 'cookie_consent=granted';

    replayPendingPurchaseConversions(buyer);

    expect(firePurchaseConversion).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`${PENDING_PREFIX}cs_corrupt`)).toBeNull();
    document.cookie = 'cookie_consent=; Max-Age=0';
  });

  it('replays without an email when a different account is signed in', () => {
    sessionStorage.setItem(
      `${PENDING_PREFIX}cs_switched`,
      JSON.stringify(pendingFor('cs_switched', 7))
    );
    document.cookie = 'cookie_consent=granted';

    replayPendingPurchaseConversions({ id: 8, email: 'other@b.test' });

    expect(firePurchaseConversion).toHaveBeenCalledWith(
      purchaseFor('cs_switched', null)
    );
    document.cookie = 'cookie_consent=; Max-Age=0';
  });

  it('replays without an email when nobody is signed in', () => {
    sessionStorage.setItem(
      `${PENDING_PREFIX}cs_signed_out`,
      JSON.stringify(pendingFor('cs_signed_out', 7))
    );
    document.cookie = 'cookie_consent=granted';

    replayPendingPurchaseConversions(null);

    expect(firePurchaseConversion).toHaveBeenCalledWith(
      purchaseFor('cs_signed_out', null)
    );
    document.cookie = 'cookie_consent=; Max-Age=0';
  });

  it('does not hold a purchase when consent was denied while the lookup was in flight', async () => {
    getCheckoutReceipt.mockImplementation(async () => {
      document.cookie = 'cookie_consent=denied';
      return ok;
    });
    firePurchaseConversion.mockReturnValue(false);

    await reportPurchaseConversion('cs_denied_mid', buyer);

    expect(firePurchaseConversion).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`${PENDING_PREFIX}cs_denied_mid`)).toBeNull();
  });

  it('sends once when a replay fires the session while the live lookup is in flight', async () => {
    sessionStorage.setItem(
      `${PENDING_PREFIX}cs_race`,
      JSON.stringify(pendingFor('cs_race'))
    );
    document.cookie = 'cookie_consent=granted';
    let release: (value: typeof ok) => void = () => {};
    getCheckoutReceipt.mockReturnValue(
      new Promise<typeof ok>((resolve) => {
        release = resolve;
      })
    );

    const live = reportPurchaseConversion('cs_race', buyer);
    replayPendingPurchaseConversions(buyer);
    expect(firePurchaseConversion).toHaveBeenCalledTimes(1);

    release(ok);
    await live;

    expect(firePurchaseConversion).toHaveBeenCalledTimes(1);
    document.cookie = 'cookie_consent=; Max-Age=0';
  });
});

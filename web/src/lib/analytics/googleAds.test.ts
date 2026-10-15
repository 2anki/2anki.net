// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_ADS_ID,
  PURCHASE_CONVERSION_LABEL,
  firePurchaseConversion,
  fireSignupConversion,
} from './googleAds';

const gtag = vi.fn();

function allowMarketing() {
  document.cookie = 'cookie_consent=granted; Path=/';
}

function denyMarketing() {
  document.cookie = 'cookie_consent=denied; Path=/';
}

const purchase = {
  sessionId: 'cs_test_abc',
  amountCents: 1200,
  currency: 'USD',
  kind: 'pass_7d',
};

beforeEach(() => {
  (globalThis as { gtag?: unknown }).gtag = gtag;
  sessionStorage.clear();
  document.documentElement.dataset.consentRegion = 'eea';
});

afterEach(() => {
  gtag.mockReset();
  document.cookie = 'cookie_consent=; Max-Age=0; Path=/';
  delete (globalThis as { gtag?: unknown }).gtag;
});

describe('firePurchaseConversion', () => {
  it('sends the Ads conversion and a GA4 purchase once consent is granted', () => {
    allowMarketing();

    expect(firePurchaseConversion(purchase)).toBe(true);

    expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
      send_to: `${GOOGLE_ADS_ID}/${PURCHASE_CONVERSION_LABEL}`,
      value: 12,
      currency: 'USD',
      transaction_id: 'cs_test_abc',
    });
    expect(gtag).toHaveBeenCalledWith(
      'event',
      'purchase',
      expect.objectContaining({ transaction_id: 'cs_test_abc', value: 12 })
    );
  });

  it('passes the signed-in email for enhanced conversions before the event', () => {
    allowMarketing();

    firePurchaseConversion({ ...purchase, email: 'a@b.test' });

    expect(gtag.mock.calls[0]).toEqual([
      'set',
      'user_data',
      { email: 'a@b.test' },
    ]);
  });

  it('fires once per session even when called again', () => {
    allowMarketing();

    expect(firePurchaseConversion(purchase)).toBe(true);
    expect(firePurchaseConversion(purchase)).toBe(false);
    expect(gtag.mock.calls.filter((c) => c[1] === 'conversion')).toHaveLength(
      1
    );
  });

  it('sends nothing without marketing consent in the EEA', () => {
    denyMarketing();

    expect(firePurchaseConversion(purchase)).toBe(false);
    expect(gtag).not.toHaveBeenCalled();
  });

  it('sends by default outside the EEA', () => {
    document.documentElement.dataset.consentRegion = 'other';

    expect(firePurchaseConversion(purchase)).toBe(true);
  });

  it('sends nothing when gtag never loaded', () => {
    allowMarketing();
    delete (globalThis as { gtag?: unknown }).gtag;

    expect(firePurchaseConversion(purchase)).toBe(false);
  });
});

describe('fireSignupConversion', () => {
  it('is a no-op until the sign-up conversion label exists', () => {
    allowMarketing();

    expect(fireSignupConversion()).toBe(false);
    expect(gtag).not.toHaveBeenCalled();
  });
});

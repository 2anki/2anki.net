// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENT_CHANGE_EVENT,
  applyConsentToGtag,
  getConsentRegion,
  getEffectiveConsent,
  needsBanner,
  readStoredConsent,
  setConsent,
} from './consent';

function fakeDoc(cookie = '', region?: string, protocol = 'https:') {
  return {
    cookie,
    documentElement: {
      dataset: region == null ? {} : { consentRegion: region },
    },
    location: { protocol },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { gtag?: unknown }).gtag;
});

describe('getConsentRegion', () => {
  it('reads the server-stamped region and defaults to eea', () => {
    expect(getConsentRegion(fakeDoc('', 'other'))).toBe('other');
    expect(getConsentRegion(fakeDoc('', 'eea'))).toBe('eea');
    expect(getConsentRegion(fakeDoc('', undefined))).toBe('eea');
    expect(getConsentRegion(fakeDoc('', 'nonsense'))).toBe('eea');
  });
});

describe('readStoredConsent', () => {
  it('returns the stored choice and ignores junk', () => {
    expect(readStoredConsent('a=1; cookie_consent=granted')).toBe('granted');
    expect(readStoredConsent('cookie_consent=denied')).toBe('denied');
    expect(readStoredConsent('cookie_consent=maybe')).toBeNull();
    expect(readStoredConsent('')).toBeNull();
  });
});

describe('getEffectiveConsent / needsBanner', () => {
  it('denies by default in the EEA until a choice is stored', () => {
    const d = fakeDoc('', 'eea');
    expect(getEffectiveConsent(d)).toBe('denied');
    expect(needsBanner(d)).toBe(true);
  });

  it('grants by default outside the EEA and shows no banner', () => {
    const d = fakeDoc('', 'other');
    expect(getEffectiveConsent(d)).toBe('granted');
    expect(needsBanner(d)).toBe(false);
  });

  it('a stored choice wins over the region default', () => {
    expect(getEffectiveConsent(fakeDoc('cookie_consent=denied', 'other'))).toBe(
      'denied'
    );
    expect(getEffectiveConsent(fakeDoc('cookie_consent=granted', 'eea'))).toBe(
      'granted'
    );
    expect(needsBanner(fakeDoc('cookie_consent=granted', 'eea'))).toBe(false);
  });
});

describe('setConsent', () => {
  it('stores the choice for a year, updates gtag consent and announces the change', () => {
    const gtag = vi.fn();
    (globalThis as { gtag?: unknown }).gtag = gtag;
    const listener = vi.fn();
    globalThis.addEventListener(CONSENT_CHANGE_EVENT, listener);
    const d = fakeDoc('', 'eea');

    setConsent('granted', d);

    expect(d.cookie).toContain('cookie_consent=granted');
    expect(d.cookie).toContain(`Max-Age=${365 * 24 * 60 * 60}`);
    expect(d.cookie).toContain('; Secure');
    expect(gtag).toHaveBeenCalledWith('consent', 'update', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBe('granted');
    globalThis.removeEventListener(CONSENT_CHANGE_EVENT, listener);
  });

  it('denying also expires the ad_click and first_touch cookies', () => {
    const writes: string[] = [];
    const d = {
      ...fakeDoc('', 'eea'),
      set cookie(value: string) {
        writes.push(value);
      },
      get cookie() {
        return '';
      },
    };

    setConsent('denied', d);

    expect(writes[0]).toContain('cookie_consent=denied');
    expect(writes[1]).toContain('ad_click=; Max-Age=0');
    expect(writes[2]).toContain('first_touch=; Max-Age=0');
  });

  it('omits Secure on http so local development still stores the choice', () => {
    const d = fakeDoc('', 'eea', 'http:');
    setConsent('granted', d);
    expect(d.cookie).not.toContain('Secure');
  });
});

describe('setConsent after Hotjar loaded', () => {
  it('reloads the page on a later deny so Hotjar stops recording', () => {
    const reload = vi.fn();
    (globalThis as { hj?: unknown }).hj = () => undefined;
    const original = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { ...original, reload },
    });

    setConsent('denied', fakeDoc('cookie_consent=granted', 'eea'));

    expect(reload).toHaveBeenCalledTimes(1);
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: original,
    });
    delete (globalThis as { hj?: unknown }).hj;
  });
});

describe('applyConsentToGtag', () => {
  it('is a no-op when gtag is not on the page', () => {
    expect(() => applyConsentToGtag('denied')).not.toThrow();
  });
});

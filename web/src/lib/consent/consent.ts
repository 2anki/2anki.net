import { AD_CLICK_COOKIE, COOKIE_CONSENT_COOKIE } from './cookies';
import { FIRST_TOUCH_COOKIE } from '../firstTouch';

export type ConsentChoice = 'granted' | 'denied';
export type ConsentRegion = 'eea' | 'other';

export const CONSENT_CHANGE_EVENT = 'consentchange';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

interface ConsentDocument {
  cookie: string;
  documentElement: { dataset: { consentRegion?: string } };
  location: { protocol: string };
}

interface GtagWindow {
  gtag?: (...args: unknown[]) => void;
  hj?: unknown;
  dispatchEvent?: (event: Event) => boolean;
  location?: { reload: () => void };
}

function doc(): ConsentDocument | null {
  return typeof document === 'undefined'
    ? null
    : (document as unknown as ConsentDocument);
}

function readCookie(cookieHeader: string, name: string): string | null {
  for (const entry of cookieHeader.split(';')) {
    const trimmed = entry.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1);
    }
  }
  return null;
}

/** The server stamps the visitor's region on <html>; missing means EEA. */
export function getConsentRegion(
  d: ConsentDocument | null = doc()
): ConsentRegion {
  return d?.documentElement.dataset.consentRegion === 'other' ? 'other' : 'eea';
}

export function readStoredConsent(
  cookieHeader: string = doc()?.cookie ?? ''
): ConsentChoice | null {
  const value = readCookie(cookieHeader, COOKIE_CONSENT_COOKIE);
  return value === 'granted' || value === 'denied' ? value : null;
}

/** What applies right now: an explicit choice, else the region default. */
export function getEffectiveConsent(
  d: ConsentDocument | null = doc()
): ConsentChoice {
  const stored = readStoredConsent(d?.cookie ?? '');
  if (stored != null) {
    return stored;
  }
  return getConsentRegion(d) === 'other' ? 'granted' : 'denied';
}

export function needsBanner(d: ConsentDocument | null = doc()): boolean {
  return (
    getConsentRegion(d) === 'eea' && readStoredConsent(d?.cookie ?? '') == null
  );
}

export function applyConsentToGtag(choice: ConsentChoice): void {
  const w = globalThis as GtagWindow;
  w.gtag?.('consent', 'update', {
    ad_storage: choice,
    ad_user_data: choice,
    ad_personalization: choice,
    analytics_storage: choice,
  });
}

export function setConsent(
  choice: ConsentChoice,
  d: ConsentDocument | null = doc()
): void {
  if (d == null) {
    return;
  }
  const secure = d.location.protocol === 'https:' ? '; Secure' : '';
  d.cookie = `${COOKIE_CONSENT_COOKIE}=${choice}; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax${secure}`;
  if (choice === 'denied') {
    d.cookie = `${AD_CLICK_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
    d.cookie = `${FIRST_TOUCH_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
  }
  applyConsentToGtag(choice);
  const w = globalThis as GtagWindow;
  w.dispatchEvent?.(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: choice }));
  // Hotjar has no client-side off switch once its script runs, so a withdrawal
  // after it loaded takes a reload to honour (the next load sees `denied`).
  if (choice === 'denied' && typeof w.hj === 'function') {
    try {
      w.location?.reload();
    } catch {
      // jsdom and some embedded views refuse reload; the cookie already says denied.
    }
  }
}

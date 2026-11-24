import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '../../lib/i18n';
import panelCss from './AiGiftPresent.module.css?raw';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

import { track } from '../../lib/analytics/track';
import { forgetNoticesShownThisLoad } from '../../lib/analytics/trackNoticeOncePerLoad';
import { setConsent } from '../../lib/consent/consent';
import { COOKIE_CONSENT_COOKIE } from '../../lib/consent/cookies';
import {
  reportUploadZoneActivity,
  type UploadZoneActivity,
} from '../../lib/upload/uploadZoneActivity';
import { CookieBanner } from '../CookieBanner/CookieBanner';
import { AiGiftPresent } from './AiGiftPresent';
import {
  hasGiftOpenedBefore,
  isCheckoutReturn,
  rememberClaimIntent,
  setGiftDismissed,
} from './giftUiState';
import { GIFT_AUTO_OPEN_DELAY_MS } from './useGiftAutoOpen';

const OPEN = {
  state: 'open',
  credits: 100,
  expiresIfClaimedNow: '2026-11-27T12:00:00.000Z',
  claimClosesAt: '2026-12-04T20:00:00.000Z',
  feedbackDue: false,
};

function serveGift(gift: unknown) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    redirected: false,
    json: async () => gift,
  })) as unknown as typeof fetch;
}

function renderPresent(isLoggedIn = false) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={['/upload']}>
        <input aria-label="Somewhere on the page" />
        <AiGiftPresent isLoggedIn={isLoggedIn} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function loadGift(isLoggedIn = false) {
  const view = renderPresent(isLoggedIn);
  await elapse(10);
  return view;
}

const panel = () => screen.queryByRole('dialog', { name: 'Free AI credits' });

const openedCalls = () =>
  vi.mocked(track).mock.calls.filter(([name]) => name === 'ai_gift_opened');

function onPage(activity: UploadZoneActivity) {
  act(() => reportUploadZoneActivity(activity));
}

const WIDE_QUERY = '(min-width: 640px)';

function screenIs(width: 'wide' | 'narrow') {
  const listeners = new Set<() => void>();
  let wide = width === 'wide';
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query === WIDE_QUERY && wide;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        listeners.delete(listener),
    }))
  );
  return {
    resize(next: 'wide' | 'narrow') {
      wide = next === 'wide';
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}

function tabIs(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

function tabBecomes(state: 'visible' | 'hidden') {
  tabIs(state);
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  forgetNoticesShownThisLoad();
  vi.mocked(track).mockClear();
  document.documentElement.dataset.consentRegion = 'other';
  reportUploadZoneActivity('idle');
  screenIs('wide');
  tabIs('visible');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  reportUploadZoneActivity('absent');
  delete document.documentElement.dataset.consentRegion;
  document.cookie = `${COOKIE_CONSENT_COOKIE}=; Max-Age=0; Path=/`;
  Reflect.deleteProperty(document, 'visibilityState');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AiGiftPresent opening by itself', () => {
  test('opens once on the idle upload zone after the page settles, without taking focus', async () => {
    serveGift(OPEN);
    await loadGift();
    const input = screen.getByRole('textbox', {
      name: 'Somewhere on the page',
    });
    input.focus();

    expect(panel()).toBeNull();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS - 20);
    expect(panel()).toBeNull();
    await elapse(20);

    expect(panel()).not.toHaveAttribute('aria-modal');
    expect(input).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Free AI credits');
    expect(
      screen.getByRole('button', { name: 'Free AI credits gift' })
    ).toHaveAttribute('aria-expanded', 'true');
    expect(openedCalls()).toEqual([
      ['ai_gift_opened', { state: 'open', signed_in: false, trigger: 'auto' }],
    ]);
  });

  test('does not open again after a reload or on another page', async () => {
    serveGift(OPEN);
    const first = await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS);
    expect(panel()).not.toBeNull();
    first.unmount();

    await loadGift(true);
    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 3);

    expect(panel()).toBeNull();
    expect(openedCalls()).toHaveLength(1);
  });

  test('never opens for a visitor who already opened it by a click', async () => {
    serveGift(OPEN);
    onPage('absent');
    const first = await loadGift();
    fireEvent.click(
      screen.getByRole('button', { name: 'Free AI credits gift' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    first.unmount();

    onPage('idle');
    await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 3);

    expect(panel()).toBeNull();
  });

  test('never opens for a visitor who hid the present', async () => {
    serveGift(OPEN);
    setGiftDismissed(true);

    await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 3);

    expect(panel()).toBeNull();
  });

  test('records a dismissal of the opened-by-itself panel and keeps focus where it was on Escape', async () => {
    serveGift(OPEN);
    await loadGift();
    const input = screen.getByRole('textbox', {
      name: 'Somewhere on the page',
    });
    input.focus();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(panel()).toBeNull();
    expect(input).toHaveFocus();
    expect(track).toHaveBeenCalledWith('ai_gift_dismissed', {
      trigger: 'auto',
      via: 'escape',
      state: 'open',
      signed_in: false,
    });
  });

  test('closes on an outside click and records how it was opened', async () => {
    serveGift(OPEN);
    await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS);

    fireEvent.pointerDown(
      screen.getByRole('textbox', { name: 'Somewhere on the page' })
    );

    expect(panel()).toBeNull();
    expect(track).toHaveBeenCalledWith('ai_gift_dismissed', {
      trigger: 'auto',
      via: 'outside',
      state: 'open',
      signed_in: false,
    });
  });

  test('records a click-opened panel closed from the present as a click dismissal', async () => {
    serveGift(OPEN);
    onPage('absent');
    await loadGift();
    const button = screen.getByRole('button', { name: 'Free AI credits gift' });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(track).toHaveBeenCalledWith('ai_gift_dismissed', {
      trigger: 'click',
      via: 'toggle',
      state: 'open',
      signed_in: false,
    });
  });

  test('tags a claim made from the opened-by-itself panel', async () => {
    serveGift(OPEN);
    await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS);

    fireEvent.click(screen.getByRole('button', { name: 'Sign up to claim' }));

    expect(track).toHaveBeenCalledWith('ai_gift_claim_clicked', {
      signed_in: false,
      page: '/register',
      trigger: 'auto',
    });
  });

  test('does not open on a page without an upload zone', async () => {
    serveGift(OPEN);
    onPage('absent');

    await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 3);

    expect(panel()).toBeNull();
  });

  test('does not cover an upload that is converting or showing its result', async () => {
    serveGift(OPEN);
    await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS / 2);
    onPage('busy');

    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 3);

    expect(panel()).toBeNull();
    expect(openedCalls()).toHaveLength(0);
  });

  test.each([
    ['closed', { state: 'closed', feedbackDue: false }],
    ['full', { state: 'full', feedbackDue: false }],
    [
      'claimed',
      {
        state: 'claimed',
        credits: 100,
        expiresAt: '2026-11-27T12:00:00.000Z',
        feedbackDue: false,
      },
    ],
  ])('does not open when the gift is %s', async (_state, gift) => {
    serveGift(gift);

    await loadGift(true);
    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 3);

    expect(panel()).toBeNull();
    expect(openedCalls()).toHaveLength(0);
  });

  test('waits for the cookie banner choice, then opens after the delay', async () => {
    delete document.documentElement.dataset.consentRegion;
    serveGift(OPEN);
    await loadGift();

    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 3);
    expect(panel()).toBeNull();

    act(() => setConsent('denied'));
    await elapse(GIFT_AUTO_OPEN_DELAY_MS - 20);
    expect(panel()).toBeNull();
    await elapse(20);

    expect(panel()).not.toBeNull();
  });

  test('leaves the sign-up return to open it as before, and does not count it as opening by itself', async () => {
    serveGift(OPEN);
    rememberClaimIntent(Date.now());

    await loadGift(true);
    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 3);

    expect(
      screen.getByRole('button', { name: 'Claim 100 credits' })
    ).toBeInTheDocument();
    expect(openedCalls()).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  test('leaves a phone-width screen alone without using up the one opening', async () => {
    screenIs('narrow');
    serveGift(OPEN);
    const phone = await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 3);

    expect(panel()).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Free AI credits gift' })
    ).toHaveAttribute('aria-expanded', 'false');
    expect(openedCalls()).toHaveLength(0);
    expect(hasGiftOpenedBefore()).toBe(false);
    phone.unmount();

    screenIs('wide');
    await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS);

    expect(panel()).not.toBeNull();
  });

  test('opens once the screen is 640px or wider', async () => {
    const screenSize = screenIs('narrow');
    serveGift(OPEN);
    await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 2);
    expect(panel()).toBeNull();

    screenSize.resize('wide');
    await elapse(GIFT_AUTO_OPEN_DELAY_MS);

    expect(panel()).not.toBeNull();
  });

  test('closes the opened-by-itself panel when an upload starts, recording it', async () => {
    serveGift(OPEN);
    await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS);
    expect(panel()).not.toBeNull();

    onPage('busy');

    expect(panel()).toBeNull();
    expect(track).toHaveBeenCalledWith('ai_gift_dismissed', {
      trigger: 'auto',
      via: 'upload',
      state: 'open',
      signed_in: false,
    });
  });

  test('hands focus to the present when an upload closes the panel while focus is inside it', async () => {
    serveGift(OPEN);
    await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS);
    screen.getByRole('button', { name: 'Sign up to claim' }).focus();

    onPage('busy');

    expect(panel()).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Free AI credits gift' })
    ).toHaveFocus();
  });

  test('leaves focus where it was when an upload closes the panel while focus is outside it', async () => {
    serveGift(OPEN);
    await loadGift();
    const input = screen.getByRole('textbox', {
      name: 'Somewhere on the page',
    });
    input.focus();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS);

    onPage('busy');

    expect(panel()).toBeNull();
    expect(input).toHaveFocus();
  });

  test('keeps a panel the visitor opened by clicking open when an upload starts', async () => {
    serveGift(OPEN);
    await loadGift();
    fireEvent.click(
      screen.getByRole('button', { name: 'Free AI credits gift' })
    );

    onPage('busy');
    await elapse(GIFT_AUTO_OPEN_DELAY_MS);

    expect(panel()).not.toBeNull();
    expect(
      vi
        .mocked(track)
        .mock.calls.filter(([name]) => name === 'ai_gift_dismissed')
    ).toHaveLength(0);
  });

  test('waits for a background tab to be looked at before opening', async () => {
    tabIs('hidden');
    serveGift(OPEN);
    await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 3);

    expect(panel()).toBeNull();
    expect(hasGiftOpenedBefore()).toBe(false);

    tabBecomes('visible');
    expect(panel()).not.toBeNull();

    tabBecomes('hidden');
    tabBecomes('visible');
    expect(openedCalls()).toHaveLength(1);
  });

  test('checks again when a background tab comes back, and stays shut if an upload started meanwhile', async () => {
    tabIs('hidden');
    serveGift(OPEN);
    await loadGift();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 2);

    onPage('busy');
    tabBecomes('visible');
    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 2);

    expect(panel()).toBeNull();
    expect(openedCalls()).toHaveLength(0);
  });

  test('never opens while the real cookie banner is on screen, and opens once it is answered', async () => {
    delete document.documentElement.dataset.consentRegion;
    serveGift(OPEN);
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={['/upload']}>
          <AiGiftPresent isLoggedIn={false} />
          <CookieBanner />
        </MemoryRouter>
      </QueryClientProvider>
    );
    await elapse(GIFT_AUTO_OPEN_DELAY_MS * 3);

    expect(screen.getByTestId('cookie-banner')).toBeInTheDocument();
    expect(panel()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Only necessary' }));
    expect(screen.queryByTestId('cookie-banner')).toBeNull();
    await elapse(GIFT_AUTO_OPEN_DELAY_MS);

    expect(panel()).not.toBeNull();
  });

  test('animates only when the visitor has not asked for reduced motion', () => {
    expect(panelCss).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.panelAuto \{\s*animation:/
    );
    expect(panelCss.match(/animation:/g)).toHaveLength(1);
  });
});

describe('checkout returns', () => {
  test.each([
    ['?checkout=success&session_id=cs_1', true],
    ['?from=pass&session_id=cs_1', true],
    ['?credits=added&session_id=cs_1', true],
    ['?pass_session=cs_1', true],
    ['?utm_source=x', false],
    ['', false],
  ])('treats %s as a checkout return: %s', (search, expected) => {
    expect(isCheckoutReturn(search)).toBe(expected);
  });

  test('remembers a checkout return for the whole page load, after the page strips the URL', async () => {
    vi.useRealTimers();
    globalThis.history.replaceState(null, '', '/upload?checkout=success');
    vi.resetModules();
    const fresh = await import('./giftUiState');
    globalThis.history.replaceState(null, '', '/upload');

    expect(fresh.pageLoadedFromCheckout()).toBe(true);
  });
});

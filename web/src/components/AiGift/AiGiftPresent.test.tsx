import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '../../lib/i18n';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

import { track } from '../../lib/analytics/track';
import { forgetNoticesShownThisLoad } from '../../lib/analytics/trackNoticeOncePerLoad';
import { AiGiftPresent, formatGiftDate } from './AiGiftPresent';
import { rememberClaimIntent } from './giftUiState';

const OPEN = {
  state: 'open',
  credits: 100,
  expiresIfClaimedNow: '2026-11-27T12:00:00.000Z',
  claimClosesAt: '2026-12-04T20:00:00.000Z',
  feedbackDue: false,
};

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  redirected: false,
  json: async () => body,
});

function routeFetch(gift: unknown, claim?: ReturnType<typeof reply>) {
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method });
    if (String(url).endsWith('/api/ai/gift/claim')) {
      return claim ?? reply(200, {});
    }
    if (String(url).endsWith('/api/ai/gift')) {
      return reply(200, gift);
    }
    return reply(200, {});
  }) as unknown as typeof fetch;
  return calls;
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderPresent(isLoggedIn: boolean, planCreditsFirst?: boolean) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={['/downloads']}>
        <AiGiftPresent
          isLoggedIn={isLoggedIn}
          planCreditsFirst={planCreditsFirst}
        />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const trigger = () =>
  screen.findByRole('button', { name: 'Free AI credits gift' });

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  forgetNoticesShownThisLoad();
  vi.mocked(track).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AiGiftPresent', () => {
  test('renders nothing while the gift is closed', async () => {
    const calls = routeFetch({ state: 'closed', feedbackDue: false });

    renderPresent(false);

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/api/ai/gift'))).toBe(true)
    );
    expect(
      screen.queryByRole('button', { name: 'Free AI credits gift' })
    ).not.toBeInTheDocument();
  });

  test('shows a signed-out visitor what the gift is and that it expires', async () => {
    routeFetch(OPEN);
    renderPresent(false);

    fireEvent.click(await trigger());

    const panel = screen.getByRole('dialog', { name: 'Free AI credits' });
    expect(panel).toHaveTextContent(
      `Claim 100 AI credits for Claude cards on your uploads. Claimed now, they expire on ${formatGiftDate('2026-11-27T12:00:00.000Z', 'en')}.`
    );
    expect(panel).toHaveTextContent('You can claim them until');
    expect(track).toHaveBeenCalledWith('ai_gift_opened', {
      state: 'open',
      signed_in: false,
    });
  });

  test('sends a signed-out visitor to sign up, returning to the upload page, without claiming', async () => {
    const calls = routeFetch(OPEN);
    renderPresent(false);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Sign up to claim' }));

    expect(screen.getByTestId('where')).toHaveTextContent(
      '/register?redirect=%2Fupload'
    );
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(track).toHaveBeenCalledWith('ai_gift_claim_clicked', {
      signed_in: false,
      page: '/register',
    });
  });

  test('offers sign-in to a visitor who has an account', async () => {
    routeFetch(OPEN);
    renderPresent(false);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByTestId('where')).toHaveTextContent(
      '/login?redirect=%2Fupload'
    );
  });

  test('opens the panel on return from sign-up so one more press claims, and claims nothing by itself', async () => {
    const calls = routeFetch(OPEN);
    rememberClaimIntent(Date.now());

    renderPresent(true);

    expect(
      await screen.findByRole('button', { name: 'Claim 100 credits' })
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  test('claims for a signed-in account and shows the credits and when they expire', async () => {
    const calls = routeFetch(
      OPEN,
      reply(200, { credits: 100, expiresAt: '2026-11-27T12:00:00.000Z' })
    );
    renderPresent(true);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Claim 100 credits' }));

    const claimed = await screen.findByText(
      'You have 100 AI credits from the gift.'
    );
    expect(claimed).toHaveFocus();
    expect(claimed.closest('[aria-live="polite"]')).not.toBeNull();
    expect(
      screen.getByText(
        `They expire on ${formatGiftDate('2026-11-27T12:00:00.000Z', 'en')}. Turn on Claude cards and drop a file to use them.`
      )
    ).toBeInTheDocument();
    expect(
      calls.filter((c) => c.url.endsWith('/claim') && c.method === 'POST')
    ).toHaveLength(1);
    expect(track).toHaveBeenCalledWith('ai_gift_claim_clicked', {
      signed_in: true,
    });
  });

  test('tells an account with a plan allowance that its plan credits go first', async () => {
    routeFetch({
      state: 'claimed',
      credits: 100,
      expiresAt: '2026-11-27T12:00:00.000Z',
      feedbackDue: false,
    });
    renderPresent(true, true);

    fireEvent.click(await trigger());

    expect(
      await screen.findByText('Your plan credits are used first.')
    ).toBeInTheDocument();
  });

  test('says nothing about spending order to an account without a plan', async () => {
    routeFetch({
      state: 'claimed',
      credits: 100,
      expiresAt: '2026-11-27T12:00:00.000Z',
      feedbackDue: false,
    });
    renderPresent(true);

    fireEvent.click(await trigger());

    expect(
      await screen.findByText('You have 100 AI credits from the gift.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Your plan credits are used first.')).toBeNull();
  });

  test('keeps the spending order out of the unclaimed offer', async () => {
    routeFetch(OPEN);
    renderPresent(true, true);

    fireEvent.click(await trigger());

    expect(
      await screen.findByRole('button', { name: 'Claim 100 credits' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Your plan credits are used first.')).toBeNull();
  });

  test('says why a claim was refused', async () => {
    routeFetch(OPEN, reply(409, { code: 'gift_already_claimed' }));
    renderPresent(true);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Claim 100 credits' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This account has already claimed the gift.'
    );
  });

  test('moves focus to the all-claimed message when it replaces the button', async () => {
    routeFetch(OPEN, reply(409, { code: 'gift_budget_full' }));
    renderPresent(true);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Claim 100 credits' }));

    expect(
      await screen.findByText('The free AI credits are all claimed for now.')
    ).toHaveFocus();
  });

  test('closes on an outside click without trapping focus', async () => {
    routeFetch(OPEN);
    renderPresent(false);

    fireEvent.click(await trigger());
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal');
    fireEvent.pointerDown(screen.getByTestId('where'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('shows the gifts as all claimed for now with nothing to press', async () => {
    routeFetch({ state: 'full', feedbackDue: false });
    renderPresent(true);

    fireEvent.click(await trigger());

    const panel = screen.getByRole('dialog');
    expect(panel).toHaveTextContent(
      'The free AI credits are all claimed for now.'
    );
    expect(
      screen.queryByRole('button', { name: /Claim|Sign up/ })
    ).not.toBeInTheDocument();
  });

  test('keeps a hidden present reachable as a small icon', async () => {
    routeFetch(OPEN);
    renderPresent(false);

    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const icon = await trigger();
    expect(icon).not.toHaveTextContent('Free AI credits');
    fireEvent.click(icon);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('closes on Escape and returns focus to the present', async () => {
    routeFetch(OPEN);
    renderPresent(false);
    const button = await trigger();
    button.focus();

    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('records the present as shown once per page load', async () => {
    routeFetch(OPEN);
    const first = renderPresent(false);
    await trigger();
    first.unmount();
    renderPresent(false);
    await trigger();

    expect(
      vi.mocked(track).mock.calls.filter(([name]) => name === 'ai_gift_shown')
    ).toEqual([['ai_gift_shown', { state: 'open', signed_in: false }]]);
  });

  test('writes dates day before month, without the year', () => {
    expect(formatGiftDate('2026-12-04T20:00:00.000Z', 'en')).not.toContain(
      '2026'
    );
    expect(
      formatGiftDate('2026-12-04T20:00:00.000Z', 'en').indexOf('December')
    ).toBeGreaterThan(0);
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '../../lib/i18n';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

import { track } from '../../lib/analytics/track';
import { DayPassCreditOffer } from './DayPassCreditOffer';

const OFFER = {
  eligible: true,
  amount: 2300,
  currency: 'usd',
  display: '$23',
  semesterDisplay: '$29',
  dayPassDisplay: '$6',
  endsAt: '2026-11-14T10:00:00.000Z',
  semesterStartsAt: '2026-11-13T10:00:00.000Z',
};

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  redirected: false,
  json: async () => body,
});

type Reply = ReturnType<typeof response>;

const routeFetch = (offer: Reply, checkout?: Reply) => {
  const creditCalls: string[] = [];
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
    if (!String(url).includes('day-pass-credit')) {
      return response(200, {});
    }
    const method = init?.method ?? 'GET';
    creditCalls.push(method);
    return method === 'POST' && checkout != null ? checkout : offer;
  }) as unknown as typeof fetch;
  return creditCalls;
};

const renderOffer = (enabled = true) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <DayPassCreditOffer placement="upload" enabled={enabled} />
      </MemoryRouter>
    </QueryClientProvider>
  );

const ctaName = 'Get the Semester Pass for $23';

describe('DayPassCreditOffer', () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'location', {
      value: originalLocation,
      configurable: true,
    });
    vi.clearAllMocks();
  });

  test('says the Day Pass price comes off a single 120-day payment that does not renew', async () => {
    routeFetch(response(200, OFFER));
    renderOffer();

    expect(
      await screen.findByText('Move up to the Semester Pass for $23')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The Day Pass price, $6, comes off the $29 Semester Pass. One payment for 120 days. Nothing renews.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The 120 days start when your Day Pass ends on /)
    ).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('day_pass_credit_offer_shown', {
      placement: 'upload',
    });
  });

  test('says the 120 days start at payment when the Day Pass already ended', async () => {
    routeFetch(response(200, { ...OFFER, semesterStartsAt: null }));
    renderOffer();

    expect(
      await screen.findByText('The 120 days start when you pay.')
    ).toBeInTheDocument();
  });

  test('gives its button secondary weight so the page keeps one main action', async () => {
    routeFetch(response(200, OFFER));
    renderOffer();

    const button = await screen.findByRole('button', { name: ctaName });
    expect(button.className).toMatch(/btnSecondary/);
    expect(button.className).not.toMatch(/btnPrimary/);
  });

  test('renders nothing and records nothing when the account is not eligible', async () => {
    const creditCalls = routeFetch(response(200, { eligible: false }));
    const { container } = renderOffer();

    await waitFor(() => expect(creditCalls).toEqual(['GET']));
    expect(container).toBeEmptyDOMElement();
    expect(track).not.toHaveBeenCalled();
  });

  test('does not ask the server when disabled', () => {
    const creditCalls = routeFetch(response(200, OFFER));
    renderOffer(false);

    expect(creditCalls).toEqual([]);
  });

  test('sends the buyer to the Stripe checkout the server opened', async () => {
    const assigned = { href: '' };
    Object.defineProperty(globalThis, 'location', {
      value: assigned,
      configurable: true,
    });
    routeFetch(
      response(200, OFFER),
      response(200, { url: 'https://checkout.stripe.com/c/cs_1' })
    );
    renderOffer();

    fireEvent.click(await screen.findByRole('button', { name: ctaName }));

    await waitFor(() =>
      expect(assigned.href).toBe('https://checkout.stripe.com/c/cs_1')
    );
    expect(track).toHaveBeenCalledWith('day_pass_credit_offer_clicked', {
      placement: 'upload',
    });
  });

  test('replaces the offer with a way to other plans when the server says it is gone', async () => {
    routeFetch(
      response(200, OFFER),
      response(409, { code: 'day_pass_credit_used' })
    );
    renderOffer();

    fireEvent.click(await screen.findByRole('button', { name: ctaName }));

    expect(
      await screen.findByText('This offer is no longer available.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all plans' })).toHaveAttribute(
      'href',
      '/pricing'
    );
    expect(
      screen.queryByText('Move up to the Semester Pass for $23')
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Offer ends/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: ctaName })
    ).not.toBeInTheDocument();
  });

  test.each([
    [
      'a checkout is already being opened',
      409,
      { code: 'day_pass_credit_checkout_open' },
    ],
    ['the prices cannot be read right now', 503, { message: 'unavailable' }],
  ])(
    'keeps the offer and asks for a retry when %s',
    async (_label, status, body) => {
      routeFetch(response(200, OFFER), response(status, body));
      renderOffer();

      fireEvent.click(await screen.findByRole('button', { name: ctaName }));

      expect(
        await screen.findByText("Checkout didn't open. Try again.")
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: ctaName })).toBeEnabled();
    }
  );
});

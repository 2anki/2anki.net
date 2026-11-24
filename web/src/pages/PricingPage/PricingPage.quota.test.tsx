import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import PricingPage from './PricingPage';
import { track } from '../../lib/analytics/track';
import { resetLastDeckMoveForTests } from '../../lib/backend/getUserLocals';
import { resetLastDeckStoreForTests } from '../../lib/upload/lastDeck';

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    baseURL: '/api/',
    startPassCheckout: vi.fn(),
    startUnlimitedCheckout: vi.fn(),
    getCheckoutPrices: vi.fn().mockResolvedValue(null),
    claimRecoveryDeck: vi.fn().mockResolvedValue(404),
  }),
}));

vi.mock('../../lib/backend/getSubscriptionStatus', () => ({
  getSubscriptionStatus: vi.fn().mockResolvedValue({ subscriptions: [] }),
}));

vi.mock('../../components/TopMessage/TopMessage', () => ({
  default: () => null,
}));

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

vi.mock('../../lib/hooks/usePricingOrderVariant', () => ({
  usePricingOrderVariant: () => 'minimal',
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function answerWith(session: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/users/debug/locals') return Promise.resolve(session());
      if (url === '/api/users/usage') {
        return Promise.resolve(
          json({ cards_used: 30, cards_limit: 100, unlimited: false })
        );
      }
      return Promise.resolve(json(null));
    })
  );
}

const paywallShownCalls = () =>
  vi.mocked(track).mock.calls.filter(([name]) => name === 'paywall_shown');

function renderPricing(isLoggedIn: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pricing']}>
        <PricingPage isLoggedIn={isLoggedIn} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  resetLastDeckStoreForTests();
  resetLastDeckMoveForTests();
  vi.mocked(track).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PricingPage paywall_shown quota', () => {
  it('sends the real cards left for a signed-in visitor', async () => {
    answerWith(() =>
      json({
        locals: { owner: 3, patreon: false, subscriber: false },
        linked_email: '',
        user: { id: 3 },
      })
    );

    renderPricing(true);

    await waitFor(() => expect(paywallShownCalls()).toHaveLength(1));
    expect(paywallShownCalls()[0][1]).toEqual({
      surface: 'pricing_page',
      quota_remaining: 70,
      variant: 'minimal',
    });
  });

  it('leaves the quota out when the session read fails and the counts are unknown', async () => {
    answerWith(() => json({ message: 'down' }, 500));

    renderPricing(false);

    await waitFor(() => expect(paywallShownCalls()).toHaveLength(1), {
      timeout: 6000,
    });
    expect(paywallShownCalls()[0][1]).toEqual({
      surface: 'pricing_page',
      variant: 'minimal',
    });
  }, 10000);
});

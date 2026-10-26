import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

import { track } from '../../lib/analytics/track';
import { STRIPE_CUSTOMER_PORTAL_URL } from '../../lib/stripePortal';
import { PastDueNotice } from './PastDueNotice';

const subscription = (status: string) => ({
  id: 'sub_test',
  status,
  created: null,
  cancel_at_period_end: false,
  cancel_at: null,
  canceled_at: null,
  current_period_end: null,
  paused_until: null,
  cancellation_reason: null,
  plan: { amount: 799, currency: 'usd', interval: 'month' },
});

function mockSubscriptions(statuses: string[]) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    redirected: false,
    json: async () => ({ subscriptions: statuses.map(subscription) }),
  });
}

const renderNotice = (enabled = true) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PastDueNotice surface="upload_limit_wall" enabled={enabled} />
    </QueryClientProvider>
  );

describe('PastDueNotice', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  test('tells a past-due subscriber why Pro stopped and how to get it back', async () => {
    mockSubscriptions(['past_due']);
    renderNotice();

    expect(
      await screen.findByText("Your payment didn't go through")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Pro is paused until this payment goes through/)
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Update payment details' });
    expect(link).toHaveAttribute('href', STRIPE_CUSTOMER_PORTAL_URL);
    expect(track).toHaveBeenCalledWith('subscription_past_due_shown', {
      subscription_id: 'sub_test',
      surface: 'upload_limit_wall',
    });

    fireEvent.click(link);
    expect(track).toHaveBeenCalledWith('subscription_manage_billing_clicked', {
      from: 'past_due',
      surface: 'upload_limit_wall',
    });
  });

  test('shows nothing for someone whose subscription is active', async () => {
    mockSubscriptions(['active']);
    renderNotice();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(
      screen.queryByText("Your payment didn't go through")
    ).not.toBeInTheDocument();
  });

  test('shows nothing and asks nothing when disabled', async () => {
    mockSubscriptions(['past_due']);
    renderNotice(false);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Your payment didn't go through")
    ).not.toBeInTheDocument();
  });
});

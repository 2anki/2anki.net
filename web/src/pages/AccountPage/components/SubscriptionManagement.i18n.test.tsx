import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import i18n from '../../../lib/i18n';
import { SubscriptionManagement } from './SubscriptionManagement';
import type { StripeSubscriptionsState } from '../../../lib/hooks/useStripeSubscriptions';

vi.mock('../../../lib/hooks/useStripeSubscriptions', () => ({
  useStripeSubscriptions: vi.fn(),
}));

import { useStripeSubscriptions } from '../../../lib/hooks/useStripeSubscriptions';

const mockUseStripeSubscriptions =
  useStripeSubscriptions as unknown as ReturnType<typeof vi.fn>;

const user = { email: 'learner@example.com', name: 'Learner' };

function withQueryClient(ui: ReactNode) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe('SubscriptionManagement in German', () => {
  beforeEach(async () => {
    mockUseStripeSubscriptions.mockReset();
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the active Stripe controls in German', () => {
    const subscription = {
      id: 'sub_1',
      status: 'active',
      created: Math.floor(Date.now() / 1000) - 120 * 24 * 60 * 60,
      cancel_at_period_end: false,
      current_period_end: 1893456000,
      cancel_at: null,
      canceled_at: null,
      paused_until: null,
      plan: { amount: 1000, currency: 'usd', interval: 'month' },
    };
    mockUseStripeSubscriptions.mockReturnValue({
      subscriptions: [subscription],
      activeSubscriptions: [subscription],
      view: { kind: 'active', subscription },
      isLoading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    } as unknown as StripeSubscriptionsState);

    render(
      withQueryClient(
        <SubscriptionManagement
          user={user}
          locals={{ subscriber: true, planSource: 'stripe' }}
          hasActivePlan
          onRefetch={vi.fn().mockResolvedValue(undefined)}
        />
      )
    );

    expect(
      screen.getByRole('button', { name: 'Abo kündigen' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Verlängert sich am/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zahlungsdaten aktualisieren' })
    ).toBeInTheDocument();
  });

  it('renders Apple management copy in German', () => {
    render(
      <SubscriptionManagement
        user={user}
        locals={{ subscriber: true, planSource: 'apple' }}
        hasActivePlan
        onRefetch={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText(/Über Apple abgerechnet/)).toBeInTheDocument();
  });
});

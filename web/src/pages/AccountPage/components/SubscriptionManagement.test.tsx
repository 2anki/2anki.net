import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { SubscriptionManagement } from './SubscriptionManagement';
import type { StripeSubscriptionsState } from '../../../lib/hooks/useStripeSubscriptions';
import { STRIPE_CUSTOMER_PORTAL_URL } from '../../../lib/stripePortal';

vi.mock('../../../lib/hooks/useStripeSubscriptions', () => ({
  useStripeSubscriptions: vi.fn(),
}));

vi.mock('../../../lib/backend/cancelSubscription', () => ({
  cancelSubscription: vi.fn(),
  cancelSubscriptionById: vi.fn(),
  submitCancellationFeedback: vi.fn(),
}));

vi.mock('../../../lib/backend/pauseSubscription', () => ({
  pauseSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
}));

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

import { useStripeSubscriptions } from '../../../lib/hooks/useStripeSubscriptions';
import { cancelSubscriptionById } from '../../../lib/backend/cancelSubscription';
import { resumeSubscription } from '../../../lib/backend/pauseSubscription';
import { track } from '../../../lib/analytics/track';

const mockUseStripeSubscriptions =
  useStripeSubscriptions as unknown as ReturnType<typeof vi.fn>;

const user = { email: 'learner@example.com', name: 'Learner' };

function withQueryClient(ui: ReactNode) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stubStripeActive(plan?: {
  amount: number | null;
  currency: string | null;
  interval: string | null;
}) {
  const subscription = {
    id: 'sub_1',
    status: 'active',
    created: Math.floor(Date.now() / 1000) - 120 * 24 * 60 * 60,
    cancel_at_period_end: false,
    current_period_end: 1893456000,
    cancel_at: null,
    canceled_at: null,
    paused_until: null,
    plan: plan ?? { amount: 1000, currency: 'usd', interval: 'month' },
  };
  mockUseStripeSubscriptions.mockReturnValue({
    subscriptions: [subscription],
    activeSubscriptions: [subscription],
    view: { kind: 'active', subscription },
    isLoading: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  } as unknown as StripeSubscriptionsState);
}

function stubStripePaused() {
  const subscription = {
    id: 'sub_paused',
    status: 'active',
    created: Math.floor(Date.now() / 1000) - 120 * 24 * 60 * 60,
    cancel_at_period_end: false,
    current_period_end: 1893456000,
    cancel_at: null,
    canceled_at: null,
    paused_until: 1900000000,
    plan: { amount: 799, currency: 'usd', interval: 'month' },
  };
  mockUseStripeSubscriptions.mockReturnValue({
    subscriptions: [subscription],
    activeSubscriptions: [subscription],
    view: { kind: 'paused', subscription },
    isLoading: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  } as unknown as StripeSubscriptionsState);
}

function stubStripeView(kind: 'scheduled' | 'cancelled' | 'none') {
  const subscription = {
    id: 'sub_other',
    status: kind === 'cancelled' ? 'canceled' : 'active',
    created: Math.floor(Date.now() / 1000) - 120 * 24 * 60 * 60,
    cancel_at_period_end: kind === 'scheduled',
    current_period_end: 1893456000,
    cancel_at: kind === 'scheduled' ? 1893456000 : null,
    canceled_at: kind === 'cancelled' ? 1880000000 : null,
    paused_until: null,
    plan: { amount: 799, currency: 'usd', interval: 'month' },
  };
  mockUseStripeSubscriptions.mockReturnValue({
    subscriptions: kind === 'none' ? [] : [subscription],
    activeSubscriptions: kind === 'scheduled' ? [subscription] : [],
    view: kind === 'none' ? { kind: 'none' } : { kind, subscription },
    isLoading: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  } as unknown as StripeSubscriptionsState);
}

function renderStripeManagement() {
  return render(
    withQueryClient(
      <SubscriptionManagement
        user={user}
        locals={{ subscriber: true, planSource: 'stripe' }}
        hasActivePlan
        onRefetch={vi.fn().mockResolvedValue(undefined)}
      />
    )
  );
}

describe('SubscriptionManagement', () => {
  beforeEach(() => {
    mockUseStripeSubscriptions.mockReset();
    vi.mocked(track).mockClear();
    vi.mocked(resumeSubscription).mockReset();
    vi.mocked(resumeSubscription).mockResolvedValue({ message: 'ok' });
  });

  it("shows Apple management copy and no Stripe controls for planSource 'apple'", () => {
    render(
      <SubscriptionManagement
        user={user}
        locals={{ subscriber: true, planSource: 'apple' }}
        hasActivePlan
        onRefetch={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText(/Billed through Apple/)).toBeTruthy();
    expect(screen.getByText(/Apple Account settings/)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Cancel subscription' })
    ).toBeNull();
    expect(screen.queryByLabelText('Subscription email')).toBeNull();
    expect(mockUseStripeSubscriptions).not.toHaveBeenCalled();
  });

  it("renders the existing Stripe controls for planSource 'stripe'", () => {
    stubStripeActive();

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
      screen.getByRole('button', { name: 'Cancel subscription' })
    ).toBeTruthy();
    expect(mockUseStripeSubscriptions).toHaveBeenCalledWith(true);
  });

  it('renders existing Stripe controls when planSource is unset (safe default)', () => {
    stubStripeActive();

    render(
      withQueryClient(
        <SubscriptionManagement
          user={user}
          locals={{ subscriber: true }}
          hasActivePlan
          onRefetch={vi.fn().mockResolvedValue(undefined)}
        />
      )
    );

    expect(
      screen.getByRole('button', { name: 'Cancel subscription' })
    ).toBeTruthy();
    expect(mockUseStripeSubscriptions).toHaveBeenCalledWith(true);
  });

  it.each([
    ['legacy monthly $6', { amount: 600, interval: 'month' }],
    ['legacy yearly $60', { amount: 6000, interval: 'year' }],
    ['unknown interval below monthly v2', { amount: 600, interval: null }],
  ])('shows the legacy-rate note for %s', (_label, plan) => {
    stubStripeActive({ currency: 'usd', ...plan });

    renderStripeManagement();

    expect(
      screen.getByText('Cancelling forfeits this legacy rate.')
    ).toBeTruthy();
  });

  it.each([
    ['v2 monthly $7.99', { amount: 799, interval: 'month' }],
    ['v2 yearly $64', { amount: 6400, interval: 'year' }],
  ])('hides the legacy-rate note for %s', (_label, plan) => {
    stubStripeActive({ currency: 'usd', ...plan });

    renderStripeManagement();

    expect(
      screen.queryByText('Cancelling forfeits this legacy rate.')
    ).toBeNull();
  });

  it('renders the duplicate-subscription heads-up and one row per active sub when there are 2+', () => {
    const subs = [
      {
        id: 'sub_early',
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: 1893456000,
        cancel_at: null,
        canceled_at: null,
        plan: { amount: 799, currency: 'usd', interval: 'month' },
      },
      {
        id: 'sub_late',
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: 1900000000,
        cancel_at: null,
        canceled_at: null,
        plan: { amount: 6400, currency: 'usd', interval: 'year' },
      },
    ];
    mockUseStripeSubscriptions.mockReturnValue({
      subscriptions: subs,
      activeSubscriptions: subs,
      view: { kind: 'active', subscription: subs[0] },
      isLoading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    } as unknown as StripeSubscriptionsState);

    renderStripeManagement();

    expect(screen.getByText(/You have 2 active subscriptions/)).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: 'Cancel this plan' })
    ).toHaveLength(2);
    expect(
      screen.queryByText('Cancelling forfeits this legacy rate.')
    ).toBeNull();
  });

  it('cancels the targeted subscription immediately after inline confirm', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    const subs = [
      {
        id: 'sub_early',
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: 1893456000,
        cancel_at: null,
        canceled_at: null,
        plan: { amount: 799, currency: 'usd', interval: 'month' },
      },
      {
        id: 'sub_late',
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: 1900000000,
        cancel_at: null,
        canceled_at: null,
        plan: { amount: 6400, currency: 'usd', interval: 'year' },
      },
    ];
    mockUseStripeSubscriptions.mockReturnValue({
      subscriptions: subs,
      activeSubscriptions: subs,
      view: { kind: 'active', subscription: subs[0] },
      isLoading: false,
      refetch,
    } as unknown as StripeSubscriptionsState);
    vi.mocked(cancelSubscriptionById).mockResolvedValue({ message: 'ok' });

    renderStripeManagement();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Cancel this plan' })[1]
    );

    const panel = screen.getByRole('group', { name: 'Cancel this plan now' });
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Cancel this plan' })
    );

    await waitFor(() =>
      expect(cancelSubscriptionById).toHaveBeenCalledWith(
        'sub_late',
        'immediate'
      )
    );
  });

  it('renders nothing when the user is not a subscriber', () => {
    const { container } = render(
      <SubscriptionManagement
        user={user}
        locals={{ subscriber: false }}
        hasActivePlan={false}
        onRefetch={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(mockUseStripeSubscriptions).not.toHaveBeenCalled();
  });

  it('opens the confirm panel and reveals the pause card on a lifecycle reason', () => {
    stubStripeActive();
    renderStripeManagement();

    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel subscription' })
    );

    expect(screen.getByText(/Why are you cancelling/)).toBeTruthy();
    expect(screen.queryByText(/Pause instead — no charge/)).toBeNull();

    fireEvent.click(screen.getByLabelText('I finished what I needed'));

    expect(screen.getByText(/Pause instead — no charge/)).toBeTruthy();
    expect(track).toHaveBeenCalledWith('subscription_pause_offered', {
      reason: 'I finished what I needed',
      tenure_days: expect.any(Number),
    });
    expect(
      screen.getByRole('button', { name: 'Keep subscription' })
    ).toBeTruthy();
  });

  it('does not reveal the pause card for annual plans', () => {
    stubStripeActive({ amount: 6400, currency: 'usd', interval: 'year' });
    renderStripeManagement();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Cancel subscription' })[0]
    );
    fireEvent.click(screen.getByLabelText('I finished what I needed'));

    expect(screen.queryByText(/Pause instead — no charge/)).toBeNull();
  });

  it('renders the paused state with a resume action', async () => {
    stubStripePaused();
    renderStripeManagement();

    expect(screen.getByText(/Paused · Resumes/)).toBeTruthy();
    expect(
      screen.getByText(/While paused, paid features are off/)
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Resume now' }));

    await waitFor(() => expect(resumeSubscription).toHaveBeenCalled());
  });

  it('fires the cancelled-during-pause event when cancelling from paused', () => {
    stubStripePaused();
    renderStripeManagement();

    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel subscription' })
    );

    expect(track).toHaveBeenCalledWith('subscription_cancelled_during_pause');
  });
  describe('update payment details', () => {
    it('links the Stripe billing portal ahead of Cancel for an active subscription', () => {
      stubStripeActive();
      renderStripeManagement();

      const link = screen.getByRole('link', { name: 'Update payment details' });
      expect(link).toHaveAttribute('href', STRIPE_CUSTOMER_PORTAL_URL);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');

      const cancel = screen.getByRole('button', {
        name: 'Cancel subscription',
      });
      expect(
        link.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        screen.getByText(
          "You'll get a secure link by email, and your plan and price stay the same."
        )
      ).toBeInTheDocument();
    });

    it('fires the manage-billing event with the plan interval on click', () => {
      stubStripeActive({ amount: 6400, currency: 'usd', interval: 'year' });
      renderStripeManagement();

      fireEvent.click(
        screen.getByRole('link', { name: 'Update payment details' })
      );

      expect(track).toHaveBeenCalledTimes(1);
      expect(track).toHaveBeenCalledWith(
        'subscription_manage_billing_clicked',
        {
          interval: 'year',
        }
      );
    });

    it('hides the link while the cancel flow is open', () => {
      stubStripeActive();
      renderStripeManagement();

      fireEvent.click(
        screen.getByRole('button', { name: 'Cancel subscription' })
      );

      expect(
        screen.queryByRole('link', { name: 'Update payment details' })
      ).toBeNull();
    });

    it('does not render the link for a paused subscription', () => {
      stubStripePaused();
      renderStripeManagement();

      expect(
        screen.queryByRole('link', { name: 'Update payment details' })
      ).toBeNull();
    });

    it.each(['scheduled', 'cancelled', 'none'] as const)(
      'does not render the link in the %s state',
      (kind) => {
        stubStripeView(kind);
        renderStripeManagement();

        expect(
          screen.queryByRole('link', { name: 'Update payment details' })
        ).toBeNull();
      }
    );

    it('does not render the link for an Apple-billed subscriber', () => {
      render(
        <SubscriptionManagement
          user={user}
          locals={{ subscriber: true, planSource: 'apple' }}
          hasActivePlan
          onRefetch={vi.fn().mockResolvedValue(undefined)}
        />
      );

      expect(
        screen.queryByRole('link', { name: 'Update payment details' })
      ).toBeNull();
    });
  });
});

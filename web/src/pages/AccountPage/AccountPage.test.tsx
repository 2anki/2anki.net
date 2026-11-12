import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AccountPage from './AccountPage';

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: vi.fn(),
}));

vi.mock('./hooks', () => ({
  useSubscriptionStatus: vi.fn(),
}));

vi.mock('../../lib/backend/api', () => ({
  post: vi.fn(),
}));

vi.mock('../../lib/backend/getSubscriptionStatus', () => ({
  getSubscriptionStatus: vi.fn(),
}));

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

vi.mock('../../lib/backend/getPassPricing', () => ({
  getPassPricing: vi.fn().mockResolvedValue({
    passes: { '120d': { display: '$29' } },
  }),
}));

vi.mock('./components', () => ({
  UserProfile: () => null,
  PlanDetails: ({ plan }: { plan: string }) => (
    <div data-testid="plan-details">{plan}</div>
  ),
  ClaimSubscription: () => <div>Paid with a different email?</div>,
  SubscriptionManagement: () => null,
  AccountDeletion: () => null,
  LogOutEverywhere: () => null,
}));

import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { getSubscriptionStatus } from '../../lib/backend/getSubscriptionStatus';
import { useSubscriptionStatus } from './hooks';

const mockGetSubscriptionStatus = vi.mocked(getSubscriptionStatus);
const mockUseUserLocals = useUserLocals as ReturnType<typeof vi.fn>;
const mockUseSubscriptionStatus = useSubscriptionStatus as ReturnType<
  typeof vi.fn
>;

function renderAccountPage(initialEntry = '/account') {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AccountPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AccountPage ClaimSubscription gate', () => {
  beforeEach(() => {
    mockUseUserLocals.mockReset();
    mockUseSubscriptionStatus.mockReset();
    mockUseUserLocals.mockReturnValue({
      isLoading: false,
      data: {
        user: { email: 'learner@example.com' },
        locals: {},
      },
      refetch: vi.fn(),
    });
  });

  it('renders the claim form when the user has no active plan', () => {
    mockUseSubscriptionStatus.mockReturnValue({
      subscriptionType: 'free',
      hasActivePlan: false,
    });

    renderAccountPage();

    expect(screen.queryByText('Paid with a different email?')).toBeTruthy();
  });

  it('hides the claim form for an active subscriber', () => {
    mockUseSubscriptionStatus.mockReturnValue({
      subscriptionType: 'subscriber',
      hasActivePlan: true,
    });

    renderAccountPage();

    expect(screen.queryByText('Paid with a different email?')).toBeNull();
  });

  it('hides the claim form for a lifetime user', () => {
    mockUseSubscriptionStatus.mockReturnValue({
      subscriptionType: 'lifetime',
      hasActivePlan: true,
    });

    renderAccountPage();

    expect(screen.queryByText('Paid with a different email?')).toBeNull();
  });

  it('confirms the purchase when returning with ?credits=added', () => {
    mockUseSubscriptionStatus.mockReturnValue({
      subscriptionType: 'subscriber',
      hasActivePlan: true,
    });

    renderAccountPage('/account?credits=added');

    expect(screen.getByText(/250 credits added\./)).toBeInTheDocument();
  });

  it('shows no purchase confirmation on a plain account visit', () => {
    mockUseSubscriptionStatus.mockReturnValue({
      subscriptionType: 'subscriber',
      hasActivePlan: true,
    });

    renderAccountPage();

    expect(screen.queryByText(/250 credits added\./)).toBeNull();
  });
});

describe('AccountPage plan card after a failed renewal', () => {
  const lapsedSubscription = {
    id: 'sub_test',
    status: 'past_due',
    created: null,
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    current_period_end: null,
    paused_until: null,
    cancellation_reason: null,
    plan: null,
  };

  const renderWithLocals = (locals: Record<string, unknown>) => {
    mockUseUserLocals.mockReturnValue({
      isLoading: false,
      data: { user: { email: 'learner@example.com' }, locals },
      refetch: vi.fn(),
    });
    mockUseSubscriptionStatus.mockReturnValue({
      plan: 'free',
      hasActivePlan: false,
    });
    renderAccountPage();
  };

  beforeEach(() => {
    mockGetSubscriptionStatus.mockReset();
  });

  it('passes the failed payment to the plan card', async () => {
    mockGetSubscriptionStatus.mockResolvedValue({
      subscriptions: [lapsedSubscription],
    });

    renderWithLocals({ subscriptionInfo: { email: 'payer@example.com' } });

    await waitFor(() =>
      expect(screen.getByTestId('plan-details').textContent).toBe('pastDue')
    );
  });

  it('holds the plan card back while the subscription is being read', async () => {
    mockGetSubscriptionStatus.mockReturnValue(new Promise(() => {}));

    renderWithLocals({ subscriptionInfo: { email: 'payer@example.com' } });

    await waitFor(() => expect(mockGetSubscriptionStatus).toHaveBeenCalled());
    expect(screen.queryByTestId('plan-details')).toBeNull();
  });

  it('shows Free once the read finds a cancelled subscription', async () => {
    mockGetSubscriptionStatus.mockResolvedValue({
      subscriptions: [{ ...lapsedSubscription, status: 'canceled' }],
    });

    renderWithLocals({ subscriptionInfo: { email: 'payer@example.com' } });

    await waitFor(() =>
      expect(screen.getByTestId('plan-details').textContent).toBe('free')
    );
  });

  it.each([
    [
      'a paused subscription',
      [{ ...lapsedSubscription, status: 'active', paused_until: 1893456000 }],
    ],
    [
      'an incomplete first charge',
      [{ ...lapsedSubscription, status: 'incomplete' }],
    ],
    [
      'an active plan beside a lapsed one',
      [{ ...lapsedSubscription, status: 'active' }, lapsedSubscription],
    ],
  ])('shows Free for %s', async (_who, subscriptions) => {
    mockGetSubscriptionStatus.mockResolvedValue({ subscriptions });

    renderWithLocals({ subscriptionInfo: { email: 'payer@example.com' } });

    await waitFor(() =>
      expect(screen.getByTestId('plan-details').textContent).toBe('free')
    );
  });

  it('shows Free when the read fails', async () => {
    mockGetSubscriptionStatus.mockRejectedValue(new Error('stripe down'));

    renderWithLocals({ subscriptionInfo: { email: 'payer@example.com' } });

    await waitFor(() =>
      expect(screen.getByTestId('plan-details').textContent).toBe('free')
    );
  });

  it('keeps the pass on the plan card with no lapsed-payment read', () => {
    mockUseUserLocals.mockReturnValue({
      isLoading: false,
      data: {
        user: { email: 'learner@example.com' },
        locals: {
          subscriber: true,
          passKind: '7d',
          subscriptionInfo: { email: 'payer@example.com' },
        },
      },
      refetch: vi.fn(),
    });
    mockUseSubscriptionStatus.mockReturnValue({
      plan: 'weekPass',
      hasActivePlan: true,
    });

    renderAccountPage();

    expect(mockGetSubscriptionStatus).not.toHaveBeenCalled();
    expect(screen.getByTestId('plan-details').textContent).toBe('weekPass');
  });

  it('keeps an Apple plan on the plan card with no lapsed-payment read', () => {
    mockUseUserLocals.mockReturnValue({
      isLoading: false,
      data: {
        user: { email: 'learner@example.com' },
        locals: {
          subscriber: true,
          planSource: 'apple',
          subscriptionInfo: { email: 'payer@example.com' },
        },
      },
      refetch: vi.fn(),
    });
    mockUseSubscriptionStatus.mockReturnValue({
      plan: 'pro',
      hasActivePlan: true,
    });

    renderAccountPage();

    expect(mockGetSubscriptionStatus).not.toHaveBeenCalled();
    expect(screen.getByTestId('plan-details').textContent).toBe('pro');
  });

  it('shows Free with no Stripe read for someone who has never paid', () => {
    renderWithLocals({ subscriptionInfo: {} });

    expect(mockGetSubscriptionStatus).not.toHaveBeenCalled();
    expect(screen.getByTestId('plan-details').textContent).toBe('free');
  });
});

describe('AccountPage Semester Pass renewal banner', () => {
  const NOW = new Date('2027-01-10T12:00:00.000Z');
  const DAY_MS = 24 * 60 * 60 * 1000;

  const renderPassHolder = (
    passKind: '7d' | '120d',
    daysLeft: number,
    hasActivePlan = false
  ) => {
    const passExpiresAt = new Date(
      NOW.getTime() + daysLeft * DAY_MS
    ).toISOString();
    mockUseUserLocals.mockReturnValue({
      isLoading: false,
      data: {
        user: { email: 'learner@example.com' },
        locals: { passKind, passExpiresAt, subscriber: hasActivePlan },
      },
      refetch: vi.fn(),
    });
    mockUseSubscriptionStatus.mockReturnValue({
      plan: passKind === '120d' ? 'semesterPass' : 'weekPass',
      hasActivePlan,
      passExpiresAt,
    });
    renderAccountPage();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers the renewal to a Semester Pass holder in the final week', () => {
    renderPassHolder('120d', 4);

    expect(
      screen.getByRole('region', { name: 'Semester Pass renewal' })
    ).toBeInTheDocument();
  });

  it('shows no renewal to a Semester Pass holder with more than a week left', () => {
    renderPassHolder('120d', 30);

    expect(
      screen.queryByRole('region', { name: 'Semester Pass renewal' })
    ).toBeNull();
  });

  it('shows no renewal to a Week Pass holder in the final days', () => {
    renderPassHolder('7d', 2);

    expect(
      screen.queryByRole('region', { name: 'Semester Pass renewal' })
    ).toBeNull();
  });

  it('shows no renewal to a subscriber who also holds a Semester Pass', () => {
    renderPassHolder('120d', 4, true);

    expect(
      screen.queryByRole('region', { name: 'Semester Pass renewal' })
    ).toBeNull();
  });
});

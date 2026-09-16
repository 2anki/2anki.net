import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

vi.mock('./components', () => ({
  UserProfile: () => null,
  PlanDetails: () => null,
  ClaimSubscription: () => <div>Paid with a different email?</div>,
  SubscriptionManagement: () => null,
  AccountDeletion: () => null,
  LogOutEverywhere: () => null,
}));

import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { useSubscriptionStatus } from './hooks';

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

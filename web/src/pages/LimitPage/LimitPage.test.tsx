import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { LimitPage } from './LimitPage';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { track } from '../../lib/analytics/track';

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

const mockTrack = vi.mocked(track);

const mockStartPassCheckout = vi.fn();

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: vi.fn(() => ({
    startPassCheckout: mockStartPassCheckout,
  })),
}));

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: vi.fn(),
}));

const mockStartUnlimitedUpgrade = vi.fn();

vi.mock('../../lib/backend/startUnlimitedUpgrade', () => ({
  startUnlimitedUpgrade: (...args: unknown[]) =>
    mockStartUnlimitedUpgrade(...args),
}));

const mockedUseUserLocals = vi.mocked(useUserLocals);

function asLoggedIn() {
  mockedUseUserLocals.mockReturnValue({
    data: { user: { id: 1, email: 'test@example.com' } },
    isLoading: false,
  } as ReturnType<typeof useUserLocals>);
}

function asAnonymous() {
  mockedUseUserLocals.mockReturnValue({
    data: undefined,
    isLoading: false,
  } as ReturnType<typeof useUserLocals>);
}

function asLoading() {
  mockedUseUserLocals.mockReturnValue({
    data: undefined,
    isLoading: true,
  } as ReturnType<typeof useUserLocals>);
}

function renderPage(initialEntries: string[] = ['/limit']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <LimitPage />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe('LimitPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asLoggedIn();
  });

  it('shows the monthly limit message', () => {
    renderPage();
    expect(screen.getByText('You reached 100 cards this month')).toBeTruthy();
  });

  it('shows the Unlimited plan title', () => {
    renderPage();
    expect(screen.getByText('Unlimited')).toBeTruthy();
  });

  it('does not advertise the Auto Sync plan', () => {
    renderPage();
    expect(screen.queryByText('Auto Sync')).toBeNull();
    expect(screen.queryByText('$30')).toBeNull();
    expect(screen.queryByText('Get Auto Sync')).toBeNull();
  });

  it('does not show a hardcoded Unlimited monthly price', () => {
    renderPage();
    const unlimitedCard = screen
      .getByText('Upgrade to Unlimited')
      .closest('div');
    if (unlimitedCard == null) throw new Error('Unlimited card not found');
    expect(within(unlimitedCard).queryByText(/\$\d/)).toBeNull();
    expect(screen.getByText('Upgrade to Unlimited')).toBeInTheDocument();
  });

  it('shows a back link to /upload', () => {
    renderPage();
    const backLink = screen.getByText('Back to upload');
    expect(backLink.closest('a')?.getAttribute('href')).toBe('/upload');
  });

  it('starts the Unlimited checkout through the API, not a static link', () => {
    renderPage();
    const upgradeLink = screen.getByText('Upgrade to Unlimited');
    expect(upgradeLink.getAttribute('href')).toBe('/pricing?source=limit-wall');

    fireEvent.click(upgradeLink);
    expect(mockStartUnlimitedUpgrade).toHaveBeenCalledWith('limit-wall');
  });

  it('features the Day Pass as the primary unblock', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Get Day Pass' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Get Week Pass' })).toBeTruthy();
    expect(screen.getByText('Most popular')).toBeTruthy();
  });

  it('starts a Day Pass checkout when Get Day Pass is clicked', async () => {
    mockStartPassCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/pass',
    });
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Get Day Pass' }));
    await vi.waitFor(() => {
      expect(mockStartPassCheckout).toHaveBeenCalledWith(
        '24h',
        undefined,
        'limit-wall'
      );
      expect(globalThis.location.href).toBe('https://checkout.stripe.com/pass');
    });
  });

  it('shows the logged-in upgrade view even when the URL says kind=anonymous', () => {
    asLoggedIn();
    renderPage(['/limit?kind=anonymous']);
    expect(screen.getByText('You reached 100 cards this month')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Get Day Pass' })).toBeTruthy();
    expect(screen.queryByText('Get Auto Sync')).toBeNull();
    expect(screen.queryByText('Sign up free')).toBeNull();
    expect(screen.queryByText('Create a free account')).toBeNull();
  });
});

describe('LimitPage — anonymous variant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asAnonymous();
  });

  it('shows the status line explaining the conversion stopped', () => {
    renderPage();
    expect(
      screen.getByText('Conversion stopped — you reached the 21-card limit')
    ).toBeTruthy();
  });

  it('shows the no-account heading', () => {
    renderPage();
    expect(
      screen.getByText('You hit the limit for converting without an account')
    ).toBeTruthy();
  });

  it('shows a "Create a free account" CTA pointing at /register', () => {
    renderPage();
    const cta = screen.getByRole('link', { name: 'Create a free account' });
    expect(cta.getAttribute('href')).toBe('/register?redirect=/upload');
  });

  it('tracks the sign-up click as the free_signup plan', () => {
    renderPage();
    fireEvent.click(
      screen.getByRole('link', { name: 'Create a free account' })
    );
    expect(mockTrack).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'limit-wall',
      plan: 'free_signup',
    });
  });

  it('renders the subheading with both caps through the translation', () => {
    renderPage();
    expect(
      screen.getByText(
        'Without an account, conversions stop at 21 cards. A free account raises that to 100 cards a month — or sign in to the one you have.'
      )
    ).toBeTruthy();
  });

  it('lists the cap-fix benefit first', () => {
    renderPage();
    expect(screen.getByText('Convert up to 100 cards a month')).toBeTruthy();
  });

  it('shows Sign in as a button-sized link under the sign-up CTA', () => {
    renderPage();
    const signIn = screen.getByRole('link', { name: 'Sign in' });
    expect(signIn.getAttribute('href')).toBe('/login?redirect=/upload');
    expect(signIn.className).toContain('planCtaSecondary');
  });

  it('tracks the sign-in click as the sign_in plan on the same event', () => {
    renderPage();
    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(mockTrack).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'limit-wall',
      plan: 'sign_in',
    });
  });

  it('does not keep the footer "Already have an account?" line', () => {
    renderPage();
    expect(screen.queryByText('Already have an account?')).toBeNull();
  });

  it('says the file stays in the browser and must be dropped again', () => {
    renderPage();
    expect(
      screen.getByText(
        "Your file wasn't uploaded — drop it in again after signing in."
      )
    ).toBeTruthy();
  });

  it('does not show the monthly-limit upgrade UI for anonymous users', () => {
    renderPage();
    expect(screen.queryByText('You reached 100 cards this month')).toBeNull();
    expect(screen.queryByText('Get Auto Sync')).toBeNull();
  });
});

describe('LimitPage — loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asLoading();
  });

  it('does not show the anonymous variant while user locals are loading', () => {
    renderPage(['/limit?kind=anonymous']);
    expect(screen.queryByText('Create a free account')).toBeNull();
    expect(
      screen.queryByText('You hit the limit for converting without an account')
    ).toBeNull();
  });
});

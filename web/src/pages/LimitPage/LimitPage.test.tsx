import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { LimitPage } from './LimitPage';
import { useUserLocals } from '../../lib/hooks/useUserLocals';

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

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
    expect(screen.queryByText('$6')).toBeNull();
    expect(screen.getByText('Upgrade to Unlimited')).toBeTruthy();
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
    expect(screen.queryByText('Sign up free and finish converting')).toBeNull();
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

  it('shows a "Sign up free and finish converting" CTA pointing at /register', () => {
    renderPage();
    const cta = screen.getByText('Sign up free and finish converting');
    expect(cta.closest('a')?.getAttribute('href')).toBe(
      '/register?redirect=/upload'
    );
  });

  it('lists the cap-fix benefit first', () => {
    renderPage();
    expect(screen.getByText('Convert up to 100 cards a month')).toBeTruthy();
  });

  it('keeps a secondary Sign in link', () => {
    renderPage();
    const signIn = screen.getByText('Sign in');
    expect(signIn.closest('a')?.getAttribute('href')).toBe(
      '/login?redirect=/upload'
    );
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
    expect(screen.queryByText('Sign up free and finish converting')).toBeNull();
    expect(
      screen.queryByText('You hit the limit for converting without an account')
    ).toBeNull();
  });
});

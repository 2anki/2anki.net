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
const mockGetCheckoutPrices = vi.fn();

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: vi.fn(() => ({
    startPassCheckout: mockStartPassCheckout,
    getCheckoutPrices: mockGetCheckoutPrices,
  })),
}));

const mockGetPassPricing = vi.fn<
  () => Promise<{ passes: Record<string, { display: string }> }>
>(() => Promise.resolve({ passes: {} }));

vi.mock('../../lib/backend/getPassPricing', () => ({
  getPassPricing: () => mockGetPassPricing(),
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

function asLoggedInWithProPrice() {
  mockedUseUserLocals.mockReturnValue({
    data: {
      user: { id: 1, email: 'test@example.com' },
      features: { limitWallProPrice: true },
    },
    isLoading: false,
  } as ReturnType<typeof useUserLocals>);
}

function asAnonymous() {
  mockedUseUserLocals.mockReturnValue({
    data: undefined,
    isLoading: false,
  } as ReturnType<typeof useUserLocals>);
}

function asAnonymousWithCardFlag() {
  mockedUseUserLocals.mockReturnValue({
    data: { features: { anonymousDayPassCard: true } },
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
    expect(screen.getByText("You've reached your monthly limit")).toBeTruthy();
    expect(
      screen.getByText(
        'Your monthly limit: 100 cards. Get a pass to keep converting now.'
      )
    ).toBeTruthy();
  });

  it('sells Pro in one line', () => {
    renderPage();
    expect(
      screen.getByText('Converting every month? Pro has no card limit.')
    ).toBeTruthy();
  });

  it('prices the pass buttons from the live pass pricing', async () => {
    mockGetPassPricing.mockResolvedValueOnce({
      passes: {
        '24h': { display: '€5' },
        '7d': { display: '€11' },
        '120d': { display: '€27' },
      },
    });
    renderPage();
    expect(
      await screen.findByRole('button', { name: 'Get Day Pass · €5' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Get Week Pass · €11' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Get Semester Pass · €27' })
    ).toBeTruthy();
  });

  it('does not advertise the Auto Sync plan', () => {
    renderPage();
    expect(screen.queryByText('Auto Sync')).toBeNull();
    expect(screen.queryByText('$30')).toBeNull();
    expect(screen.queryByText('Get Auto Sync')).toBeNull();
  });

  it('shows the Pro monthly price from the checkout prices when the flag is on', async () => {
    asLoggedInWithProPrice();
    mockGetCheckoutPrices.mockResolvedValue({
      monthly: { cents: 799 },
      annual: { cents: 6400 },
      legacy: false,
      lockInDeadline: null,
    });
    renderPage();
    expect(
      await screen.findByText('Converting every month? Pro is $7.99/month.')
    ).toBeTruthy();
  });

  it('never asks for the Pro price when the flag is off', () => {
    renderPage();
    expect(mockGetCheckoutPrices).not.toHaveBeenCalled();
    expect(screen.queryByText(/Pro is .*\/month/)).toBeNull();
  });

  it('leaves the Pro card without a price when the price cannot be read', async () => {
    asLoggedInWithProPrice();
    mockGetCheckoutPrices.mockResolvedValue(null);
    renderPage();
    await screen.findByText('Upgrade to Pro');
    expect(screen.queryByText(/Pro is .*\/month/)).toBeNull();
  });

  it('does not show a hardcoded Pro monthly price', () => {
    renderPage();
    const unlimitedCard = screen.getByText('Upgrade to Pro').closest('p');
    if (unlimitedCard == null) throw new Error('Pro line not found');
    expect(within(unlimitedCard).queryByText(/\$\d/)).toBeNull();
    expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
  });

  it('shows a back link to /upload', () => {
    renderPage();
    const backLink = screen.getByText('Back to upload');
    expect(backLink.closest('a')?.getAttribute('href')).toBe('/upload');
  });

  it('starts the Pro checkout through the API, not a static link', () => {
    renderPage();
    const upgradeLink = screen.getByText('Upgrade to Pro');
    expect(upgradeLink.getAttribute('href')).toBe('/pricing?source=limit-wall');

    fireEvent.click(upgradeLink);
    expect(mockStartUnlimitedUpgrade).toHaveBeenCalledWith('limit-wall');
  });

  it('features the Day Pass as the primary unblock', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: 'Get Day Pass · $6' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Get Week Pass · $12' })
    ).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Get Day Pass · $6' }));
    await vi.waitFor(() => {
      expect(mockStartPassCheckout).toHaveBeenCalledWith(
        '24h',
        undefined,
        'limit-wall'
      );
      expect(globalThis.location.href).toBe('https://checkout.stripe.com/pass');
    });
  });

  it('tells a pass holder when the current pass ends instead of a generic error', async () => {
    mockStartPassCheckout.mockResolvedValue({
      status: 'conflict',
      code: 'pass_still_active',
      expiresAt: '2026-10-08T12:00:00.000Z',
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Get Day Pass · $6' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your pass runs until');
    expect(alert.textContent).toContain('2026');
    expect(alert.textContent).toContain('Buy the next one when it runs out');
  });

  it('leads with the passes and puts Pro after them', () => {
    renderPage();
    const passesLabel = screen.getByText('Pay once — no subscription');
    const proLine = screen.getByText(/Converting every month\?/);
    expect(
      Boolean(
        passesLabel.compareDocumentPosition(proLine) &
        Node.DOCUMENT_POSITION_FOLLOWING
      )
    ).toBe(true);
  });

  it('offers the Semester Pass next to the Day and Week Pass', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: 'Get Semester Pass · $29' })
    ).toBeTruthy();
    expect(screen.getByText('Best value')).toBeTruthy();
  });

  it('starts a Semester Pass checkout tagged to the wall and tracks the click', async () => {
    mockStartPassCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/semester',
    });
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });
    renderPage();
    fireEvent.click(
      screen.getByRole('button', { name: 'Get Semester Pass · $29' })
    );
    expect(mockTrack).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'limit-wall',
      plan: 'semester_pass',
    });
    expect(mockTrack).toHaveBeenCalledWith('paywall_pass_clicked', {
      surface: 'limit-wall',
      plan: 'semester',
    });
    await vi.waitFor(() => {
      expect(mockStartPassCheckout).toHaveBeenCalledWith(
        '120d',
        undefined,
        'limit-wall'
      );
      expect(globalThis.location.href).toBe(
        'https://checkout.stripe.com/semester'
      );
    });
  });

  it('shows the logged-in upgrade view even when the URL says kind=anonymous', () => {
    asLoggedIn();
    renderPage(['/limit?kind=anonymous']);
    expect(screen.getByText("You've reached your monthly limit")).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Get Day Pass · $6' })
    ).toBeTruthy();
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

  it('says the upload made more cards than the no-account cap', () => {
    renderPage(['/limit?kind=anonymous']);
    expect(
      screen.getByText('Your upload made more than 21 cards')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Conversion stopped/)).not.toBeInTheDocument();
  });

  it('shows the no-account heading even when the URL says kind=card_count', () => {
    renderPage(['/limit?kind=card_count']);
    expect(
      screen.getByText('You hit the limit for converting without an account')
    ).toBeTruthy();
    expect(screen.queryByText("You've reached your monthly limit")).toBeNull();
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
        'Without an account, you can download up to 21 cards at a time. A free account raises that to 100 cards a month — or sign in to the one you have.'
      )
    ).toBeInTheDocument();
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

  it('says the file was not kept and must be dropped again', () => {
    renderPage(['/limit?kind=anonymous']);
    expect(
      screen.getByText(
        "We didn't keep your file — drop it in again after signing in."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/wasn't uploaded/)).not.toBeInTheDocument();
  });

  it.each([
    ['/limit'],
    ['/limit?ref=upload-limit-wall'],
    ['/limit?kind=file_size'],
    ['/limit?kind=card_count'],
  ])(
    'claims no converted upload on %s, which no card-cap wall sent',
    (entry) => {
      renderPage([entry]);
      expect(
        screen.queryByText('Your upload made more than 21 cards')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/We didn't keep your file/)
      ).not.toBeInTheDocument();
      expect(
        screen.getByText('You hit the limit for converting without an account')
      ).toBeInTheDocument();
    }
  );

  it('offers a Day Pass with no account while sign-up stays the primary action', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: /Get Day Pass · / })
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Create a free account' }).className
    ).toContain('planCtaPrimary');
  });

  it('does not show the monthly-limit upgrade UI for anonymous users', () => {
    renderPage();
    expect(screen.queryByText("You've reached your monthly limit")).toBeNull();
    expect(screen.queryByText('Get Auto Sync')).toBeNull();
  });
});

describe('LimitPage — anonymous Day Pass card variant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asAnonymousWithCardFlag();
  });

  it('keeps today single-card layout when the flag is off, even with a card count', () => {
    asAnonymous();
    renderPage(['/limit?cards=340']);
    expect(screen.queryByRole('button', { name: /Get all/ })).toBeNull();
    expect(mockTrack).toHaveBeenCalledWith('paywall_shown', {
      surface: 'limit-wall',
      variant: 'anonymous',
    });
  });

  it('says the file was not kept on the free account card after the card cap', () => {
    renderPage(['/limit?kind=anonymous&cards=40']);
    expect(
      screen.getByText('Your upload made more than 21 cards')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "We didn't keep your file — drop it in again after signing in."
      )
    ).toBeInTheDocument();
  });

  it.each([['/limit?cards=40'], ['/limit?ref=upload-limit-wall']])(
    'claims no converted upload on the Day Pass card wall from %s',
    (entry) => {
      renderPage([entry]);
      expect(
        screen.queryByText('Your upload made more than 21 cards')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/We didn't keep your file/)
      ).not.toBeInTheDocument();
      expect(screen.getByText('Day Pass')).toBeInTheDocument();
    }
  );

  it('shows the Day Pass as its own card next to the free account', () => {
    renderPage(['/limit?cards=40']);
    expect(screen.getByText('Day Pass')).toBeTruthy();
    expect(screen.getByText('Up to 100 cards every month.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Get all 40 cards now' })
    ).toBeTruthy();
  });

  it('renders the Day Pass card before the free account so it leads on mobile', () => {
    renderPage(['/limit?cards=40']);
    const dayPass = screen.getByText('Day Pass');
    const freeAccount = screen.getByText('Free account');
    expect(
      Boolean(
        dayPass.compareDocumentPosition(freeAccount) &
        Node.DOCUMENT_POSITION_FOLLOWING
      )
    ).toBe(true);
  });

  it('ignores a non-numeric or oversized card count', () => {
    renderPage(['/limit?cards=99999']);
    expect(screen.getByText('Day Pass')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Get every card now' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Get all/ })).toBeNull();
  });

  it('keeps the free account the featured option within a free month', () => {
    renderPage(['/limit?cards=40']);
    const signUp = screen.getByRole('link', { name: 'Create a free account' });
    expect(signUp.className).toContain('planCtaPrimary');
    expect(
      screen.getByRole('button', { name: 'Get all 40 cards now' }).className
    ).toContain('buttonSecondary');
  });

  it('leads with the Day Pass when the deck is over a free month', () => {
    renderPage(['/limit?cards=340']);
    expect(
      screen.getByText(
        'This deck has 340 cards. A free account covers 100 a month. A Day Pass gives you all of them now, no account.'
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Get all 340 cards now' }).className
    ).toContain('buttonPrimary');
  });

  it('keeps free sign-up a full, visible option when the Day Pass leads', () => {
    renderPage(['/limit?cards=340']);
    const signUp = screen.getByRole('link', { name: 'Create a free account' });
    expect(signUp.getAttribute('href')).toBe('/register?redirect=/upload');
    expect(signUp.className).toContain('planCtaSecondary');
  });

  it('tags paywall_shown with the over-a-month deck bucket', () => {
    renderPage(['/limit?cards=340']);
    expect(mockTrack).toHaveBeenCalledWith('paywall_shown', {
      surface: 'limit-wall',
      variant: 'anonymous',
      deck_cards: 'over_free_month',
    });
  });

  it('tags paywall_shown with the within-a-month deck bucket', () => {
    renderPage(['/limit?cards=40']);
    expect(mockTrack).toHaveBeenCalledWith('paywall_shown', {
      surface: 'limit-wall',
      variant: 'anonymous',
      deck_cards: 'within_free_month',
    });
  });
});

function asAnonymousPassFirst() {
  mockedUseUserLocals.mockReturnValue({
    data: { features: { limitWallPassFirst: true } },
    isLoading: false,
  } as ReturnType<typeof useUserLocals>);
}

function asLoggedInPassFirst() {
  mockedUseUserLocals.mockReturnValue({
    data: {
      user: { id: 1, email: 'test@example.com' },
      features: { limitWallPassFirst: true },
    },
    isLoading: false,
  } as ReturnType<typeof useUserLocals>);
}

function follows(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
  );
}

describe('LimitPage — pass-first wall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asAnonymousPassFirst();
  });

  it('leads with the Semester Pass, puts the Day Pass beside it and free sign-up after both', () => {
    renderPage(['/limit?kind=anonymous&cards=184']);
    const semester = screen.getByRole('button', { name: /Semester Pass/ });
    const day = screen.getByRole('button', { name: /Day Pass/ });
    const signUp = screen.getByRole('link', { name: 'Create a free account' });
    const signIn = screen.getByRole('link', { name: 'Sign in' });

    expect(semester.className).toContain('primary');
    expect(day.className).toContain('secondary');
    expect(follows(semester, day)).toBe(true);
    expect(follows(day, signUp)).toBe(true);
    expect(follows(signUp, signIn)).toBe(true);
    expect(signUp.className).not.toContain('planCta');
    expect(signUp.getAttribute('href')).toBe('/register?redirect=/upload');
  });

  it('says the file was not kept under the pass-first wall after the card cap', () => {
    renderPage(['/limit?kind=anonymous&cards=184']);
    expect(
      screen.getByText(
        "We didn't keep your file — drop it in again after signing in."
      )
    ).toBeInTheDocument();
  });

  it('claims no converted upload on the pass-first wall without a card-cap entry', () => {
    renderPage(['/limit?ref=upload-limit-wall']);
    expect(
      screen.queryByText(/We didn't keep your file/)
    ).not.toBeInTheDocument();
  });

  it('states the real card count from the redirect', () => {
    renderPage(['/limit?kind=anonymous&cards=184']);
    expect(screen.getByText('This file makes 184 cards')).toBeTruthy();
    expect(
      screen.getByText(
        'After paying, drop the file again to get all 184 cards.'
      )
    ).toBeTruthy();
  });

  it('starts a Semester Pass checkout tagged to the anonymous wall', async () => {
    mockStartPassCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/semester',
    });
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });
    renderPage(['/limit?kind=anonymous']);
    fireEvent.click(screen.getByRole('button', { name: /Semester Pass/ }));
    expect(mockTrack).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'anonymous-limit-wall',
      plan: 'semester_pass',
    });
    await vi.waitFor(() => {
      expect(mockStartPassCheckout).toHaveBeenCalledWith(
        '120d',
        undefined,
        'anonymous-limit-wall'
      );
    });
  });

  it('still tracks the free sign-up link as free_signup', () => {
    renderPage(['/limit?kind=anonymous']);
    fireEvent.click(
      screen.getByRole('link', { name: 'Create a free account' })
    );
    expect(mockTrack).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'limit-wall',
      plan: 'free_signup',
    });
  });

  it('keeps free sign-up as the primary button when the flag is off', () => {
    asAnonymous();
    renderPage(['/limit?kind=anonymous&cards=184']);
    expect(
      screen.getByRole('link', { name: 'Create a free account' }).className
    ).toContain('planCtaPrimary');
    expect(screen.queryByRole('button', { name: /Semester Pass/ })).toBeNull();
    expect(screen.queryByText('This file makes 184 cards')).toBeNull();
  });

  it('still shows the Pro price when both the pass-first and Pro price flags are on', async () => {
    mockedUseUserLocals.mockReturnValue({
      data: {
        user: { id: 1, email: 'test@example.com' },
        features: { limitWallPassFirst: true, limitWallProPrice: true },
      },
      isLoading: false,
    } as ReturnType<typeof useUserLocals>);
    mockGetCheckoutPrices.mockResolvedValue({
      monthly: { cents: 799 },
      annual: { cents: 6400 },
      legacy: false,
      lockInDeadline: null,
    });
    renderPage();
    expect(
      await screen.findByText('Converting every month? Pro is $7.99/month.')
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Get Semester Pass · $29' })
    ).toBeTruthy();
  });

  it('leads with the passes over the Day Pass card when both anonymous flags are on', () => {
    mockedUseUserLocals.mockReturnValue({
      data: {
        features: { limitWallPassFirst: true, anonymousDayPassCard: true },
      },
      isLoading: false,
    } as ReturnType<typeof useUserLocals>);
    renderPage(['/limit?kind=anonymous&cards=184']);
    expect(screen.getByRole('button', { name: /Semester Pass/ })).toBeTruthy();
    expect(screen.queryByText('Free account')).toBeNull();
  });

  it('puts the passes before Pro and keeps the Day Pass Most popular for a signed-in account', () => {
    asLoggedInPassFirst();
    renderPage();
    const passesLabel = screen.getByText('Pay once — no subscription');
    const proLine = screen.getByText(/Converting every month\?/);
    expect(follows(passesLabel, proLine)).toBe(true);
    expect(screen.getAllByText('Most popular')).toHaveLength(1);
    expect(screen.getAllByText('Best value')).toHaveLength(1);
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

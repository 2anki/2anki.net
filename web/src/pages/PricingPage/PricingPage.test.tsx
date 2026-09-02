import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import PricingPage from './PricingPage';

const mockStartPassCheckout = vi.fn();
const mockStartUnlimitedCheckout = vi.fn();
const mockGetCheckoutPrices = vi.fn();

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    startPassCheckout: mockStartPassCheckout,
    startUnlimitedCheckout: mockStartUnlimitedCheckout,
    getCheckoutPrices: mockGetCheckoutPrices,
  }),
}));

vi.mock('../../components/TopMessage/TopMessage', () => ({
  default: () => null,
}));

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

const mockUseCardUsage = vi.fn();

vi.mock('../../lib/hooks/useCardUsage', () => ({
  useCardUsage: () => mockUseCardUsage(),
}));

const { mockPricingVariant } = vi.hoisted(() => ({
  mockPricingVariant: {
    current: 'minimal' as 'minimal' | 'unlimited-first' | 'minimal',
  },
}));

vi.mock('../../lib/hooks/usePricingOrderVariant', () => ({
  usePricingOrderVariant: () => mockPricingVariant.current,
}));

beforeEach(() => {
  mockPricingVariant.current = 'minimal';
  mockGetCheckoutPrices.mockResolvedValue(null);
});

type AnalyticsGlobals = {
  hj?: ReturnType<typeof vi.fn>;
  gtag?: ReturnType<typeof vi.fn>;
};

const renderAt = (
  path: string,
  props: Partial<Parameters<typeof PricingPage>[0]> = {}
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <PricingPage isLoggedIn={false} {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('PricingPage try-free CTA', () => {
  beforeEach(() => {
    mockUseCardUsage.mockReturnValue(null);
  });

  it('renders no Convert a deck free link for any visitor', () => {
    renderAt('/pricing', { isLoggedIn: false });
    expect(
      screen.queryByRole('link', { name: 'Convert a deck free' })
    ).not.toBeInTheDocument();
  });
});

describe('PricingPage Unlimited benefits', () => {
  it('lists parallel conversions as a benefit', () => {
    renderAt('/pricing');
    expect(
      screen.getAllByText('Run multiple conversions at once').length
    ).toBeGreaterThan(0);
  });

  it('features the Week Pass and marks the Semester Pass best value', () => {
    renderAt('/pricing');
    expect(screen.getByText('Most popular')).toBeInTheDocument();
    expect(screen.getByText('Best value')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get Week Pass' })
    ).toBeInTheDocument();
  });
});

describe('PricingPage layout', () => {
  it('renders the Unlimited card', () => {
    renderAt('/pricing');
    expect(screen.getAllByText('Unlimited').length).toBeGreaterThan(0);
  });

  it('does not sell Auto Sync as a standalone plan', () => {
    renderAt('/pricing', { isLoggedIn: true });
    expect(
      screen.queryByRole('button', { name: 'Get Auto Sync' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('What is Auto Sync?')).not.toBeInTheDocument();
  });

  it('does not show the auto-sync upsell context banner', () => {
    renderAt('/pricing?upsell=auto-sync', { isLoggedIn: true });
    expect(
      screen.queryByText(
        'Auto Sync sends any deck straight to your Anki — no downloading, no importing.'
      )
    ).not.toBeInTheDocument();
  });

  it('does not offer Lifetime to new members', () => {
    renderAt('/pricing');
    expect(
      screen.queryByRole('link', { name: 'Request Lifetime' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Lifetime' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('From $345')).not.toBeInTheDocument();
  });

  it('shows the v2 fallback Unlimited price in the comparison table', async () => {
    renderAt('/pricing');
    expect(await screen.findByText('$7.99 / mo')).toBeInTheDocument();
  });

  it('shows the fetched v2 Unlimited price in the comparison table', async () => {
    mockGetCheckoutPrices.mockResolvedValue({
      monthly: { cents: 799 },
      annual: { cents: 6400 },
      legacy: false,
      lockInDeadline: null,
    });
    renderAt('/pricing');
    expect(await screen.findByText('$7.99 / mo')).toBeInTheDocument();
    expect(screen.queryByText('$6 / mo')).not.toBeInTheDocument();
  });

  it('shows the Pay once section label', () => {
    renderAt('/pricing');
    expect(screen.getByText('Pay once — no subscription')).toBeInTheDocument();
  });

  it('shows the subscription section label', () => {
    renderAt('/pricing');
    expect(screen.getByText('Prefer a subscription?')).toBeInTheDocument();
  });

  it('leads with the pay-once passes above the monthly plans', () => {
    renderAt('/pricing');
    const passLabel = screen.getByText('Pay once — no subscription');
    const monthlyLabel = screen.getByText('Prefer a subscription?');
    expect(
      passLabel.compareDocumentPosition(monthlyLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('leads with the monthly plans when the variant is unlimited-first', () => {
    mockPricingVariant.current = 'unlimited-first';
    renderAt('/pricing');
    const monthlyLabel = screen.getByText('Prefer a subscription?');
    const passLabel = screen.getByText('Pay once — no subscription');
    expect(
      monthlyLabel.compareDocumentPosition(passLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText('Most popular')).toBeInTheDocument();
  });

  it('drops the kicker, intro, and social proof in the minimal variant', () => {
    mockPricingVariant.current = 'minimal';
    renderAt('/pricing');
    expect(screen.queryByText('Plans')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Trusted by 19,000+ learners worldwide')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/no account needed to start/)
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get Day Pass' })
    ).toBeInTheDocument();
  });

  it('shows the risk-reversal reassurance strip', () => {
    renderAt('/pricing');
    expect(screen.getByText('Cancel anytime — one click')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your decks are yours — native .apkg, works in any Anki client'
      )
    ).toBeInTheDocument();
  });

  it('shows Day Pass and Week Pass as full cards with visible buttons', () => {
    renderAt('/pricing');
    expect(
      screen.getByRole('button', { name: 'Get Day Pass' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get Week Pass' })
    ).toBeInTheDocument();
  });

  it('shows philosophy line', () => {
    renderAt('/pricing');
    expect(
      screen.getByText('Free works forever. Paid plans support 2anki.net.')
    ).toBeInTheDocument();
  });

  it('renders the feature overview grid', () => {
    renderAt('/pricing');
    expect(
      screen.getByRole('heading', { name: 'Everything 2anki does' })
    ).toBeInTheDocument();
  });

  it('renders the plan comparison table', () => {
    renderAt('/pricing');
    expect(
      screen.getByRole('heading', { name: 'Compare every plan' })
    ).toBeInTheDocument();
  });

  it('renders the FAQ section with visible questions', () => {
    renderAt('/pricing');
    expect(
      screen.getByRole('heading', { name: 'Questions & answers' })
    ).toBeInTheDocument();
    expect(screen.getByText('What is the Unlimited plan?')).toBeInTheDocument();
  });
});

describe('PricingPage paywall telemetry', () => {
  beforeEach(() => {
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
  });

  afterEach(() => {
    delete (globalThis as AnalyticsGlobals).hj;
    delete (globalThis as AnalyticsGlobals).gtag;
  });

  it('fires paywall_pricing_viewed when source=paywall-cancel', () => {
    renderAt('/pricing?source=paywall-cancel');
    expect((globalThis as AnalyticsGlobals).hj).toHaveBeenCalledWith(
      'event',
      'paywall_pricing_viewed'
    );
    expect((globalThis as AnalyticsGlobals).gtag).toHaveBeenCalledWith(
      'event',
      'paywall_pricing_viewed'
    );
  });

  it('does not fire paywall_pricing_viewed without source=paywall-cancel', () => {
    renderAt('/pricing');
    expect((globalThis as AnalyticsGlobals).hj).not.toHaveBeenCalled();
    expect((globalThis as AnalyticsGlobals).gtag).not.toHaveBeenCalled();
  });
});

describe('PricingPage pricing honesty', () => {
  it('does not mention Anki desktop in browser anywhere on the page', () => {
    renderAt('/pricing');
    expect(
      screen.queryByText(/anki desktop in your browser/i)
    ).not.toBeInTheDocument();
  });

  it('shows the accurate Anki → Notion note caps (1,000 free / 10,000 paid)', () => {
    renderAt('/pricing');
    expect(
      screen.getByRole('row', { name: /Anki → Notion notes/ })
    ).toBeInTheDocument();
    expect(screen.getAllByText('1,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10,000').length).toBeGreaterThan(0);
  });
});

describe('PricingPage internal event tracking', () => {
  beforeEach(() => {
    mockUseCardUsage.mockReturnValue(null);
  });

  it('tracks paywall_shown with surface=pricing_page on mount', async () => {
    const { track } = await import('../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    renderAt('/pricing');

    expect(trackMock).toHaveBeenCalledWith('paywall_shown', {
      surface: 'pricing_page',
      variant: 'minimal',
    });
  });

  it('tracks paywall_upgrade_clicked with plan=day_pass when Day Pass is clicked', async () => {
    const { track } = await import('../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    mockStartPassCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/day',
    });
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });

    renderAt('/pricing', { isLoggedIn: true });
    fireEvent.click(screen.getByRole('button', { name: 'Get Day Pass' }));

    await waitFor(() => {
      expect(trackMock).toHaveBeenCalledWith('paywall_upgrade_clicked', {
        surface: 'pricing_page',
        plan: 'day_pass',
        variant: 'minimal',
      });
    });
  });

  it('tracks paywall_upgrade_clicked with plan=week_pass when Week Pass is clicked', async () => {
    const { track } = await import('../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    mockStartPassCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/week',
    });
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });

    renderAt('/pricing', { isLoggedIn: true });
    fireEvent.click(screen.getByRole('button', { name: 'Get Week Pass' }));

    await waitFor(() => {
      expect(trackMock).toHaveBeenCalledWith('paywall_upgrade_clicked', {
        surface: 'pricing_page',
        plan: 'week_pass',
        variant: 'minimal',
      });
    });
  });

  it('tracks paywall_upgrade_clicked with plan=semester_pass and starts checkout', async () => {
    const { track } = await import('../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    mockStartPassCheckout.mockClear();
    mockStartPassCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/semester',
    });
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });

    renderAt('/pricing', { isLoggedIn: true });
    fireEvent.click(screen.getByRole('button', { name: 'Get Semester Pass' }));

    await waitFor(() => {
      expect(trackMock).toHaveBeenCalledWith('paywall_upgrade_clicked', {
        surface: 'pricing_page',
        plan: 'semester_pass',
        variant: 'minimal',
      });
    });
    expect(mockStartPassCheckout).toHaveBeenCalledWith(
      '120d',
      'minimal',
      'pricing_page'
    );
  });

  it('tracks paywall_upgrade_clicked with plan=unlimited when Upgrade button is clicked', async () => {
    const { track } = await import('../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    mockStartUnlimitedCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/unlimited',
    });
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });

    renderAt('/pricing', { isLoggedIn: true });
    fireEvent.click(
      screen.getByRole('button', { name: 'Get Unlimited — billed monthly' })
    );

    await waitFor(() => {
      expect(trackMock).toHaveBeenCalledWith('paywall_upgrade_clicked', {
        surface: 'pricing_page',
        plan: 'unlimited',
        variant: 'minimal',
      });
    });
  });
});

describe('PricingPage anonymous upgrade-click tracking', () => {
  beforeEach(() => {
    mockUseCardUsage.mockReturnValue(null);
  });

  it('starts an anonymous Day Pass checkout without a login detour', async () => {
    const { track } = await import('../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    mockStartPassCheckout.mockClear();
    mockStartPassCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.test/anon-day',
    });
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });

    renderAt('/pricing', { isLoggedIn: false });
    fireEvent.click(screen.getByRole('button', { name: 'Get Day Pass' }));

    expect(trackMock).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'pricing_page',
      plan: 'day_pass',
      variant: 'minimal',
    });
    await waitFor(() => {
      expect(mockStartPassCheckout).toHaveBeenCalledWith(
        '24h',
        'minimal',
        'pricing_page'
      );
      expect(globalThis.location.href).toBe(
        'https://checkout.stripe.test/anon-day'
      );
    });
  });

  it('starts an anonymous Week Pass checkout without a login detour', async () => {
    const { track } = await import('../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    mockStartPassCheckout.mockClear();
    mockStartPassCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.test/anon-week',
    });
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });

    renderAt('/pricing', { isLoggedIn: false });
    fireEvent.click(screen.getByRole('button', { name: 'Get Week Pass' }));

    expect(trackMock).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'pricing_page',
      plan: 'week_pass',
      variant: 'minimal',
    });
    await waitFor(() => {
      expect(mockStartPassCheckout).toHaveBeenCalledWith(
        '7d',
        'minimal',
        'pricing_page'
      );
      expect(globalThis.location.href).toBe(
        'https://checkout.stripe.test/anon-week'
      );
    });
  });

  it('tracks paywall_upgrade_clicked then redirects to login for an anonymous Unlimited click', async () => {
    const { track } = await import('../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    mockStartUnlimitedCheckout.mockClear();
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });

    renderAt('/pricing', { isLoggedIn: false });
    fireEvent.click(
      screen.getByRole('button', { name: 'Get Unlimited — billed monthly' })
    );

    expect(trackMock).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'pricing_page',
      plan: 'unlimited',
      variant: 'minimal',
    });
    expect(globalThis.location.href).toBe('/login?redirect=/pricing');
    expect(mockStartUnlimitedCheckout).not.toHaveBeenCalled();
  });
});

describe('PricingPage pricing_left telemetry', () => {
  beforeEach(() => {
    mockUseCardUsage.mockReturnValue(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires pricing_left with seconds_on_page when unmounted', async () => {
    const { track } = await import('../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    const { unmount } = renderAt('/pricing');
    vi.advanceTimersByTime(8000);
    act(() => {
      unmount();
    });

    expect(trackMock).toHaveBeenCalledWith('pricing_left', {
      seconds_on_page: 8,
    });
  });

  it('fires pricing_left with 0 seconds when unmounted immediately', async () => {
    const { track } = await import('../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    const { unmount } = renderAt('/pricing');
    act(() => {
      unmount();
    });

    expect(trackMock).toHaveBeenCalledWith('pricing_left', {
      seconds_on_page: 0,
    });
  });
});

describe('PricingPage quota_remaining in paywall_shown', () => {
  it('includes quota_remaining when card usage is available', async () => {
    mockUseCardUsage.mockReturnValue({
      cards_used: 60,
      cards_limit: 100,
      unlimited: false,
      loading: false,
    });
    const { track } = await import('../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    renderAt('/pricing');

    expect(trackMock).toHaveBeenCalledWith('paywall_shown', {
      surface: 'pricing_page',
      quota_remaining: 40,
      variant: 'minimal',
    });
  });

  it('omits quota_remaining when card usage is not loaded', async () => {
    mockUseCardUsage.mockReturnValue(null);
    const { track } = await import('../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    renderAt('/pricing');

    expect(trackMock).toHaveBeenCalledWith('paywall_shown', {
      surface: 'pricing_page',
      variant: 'minimal',
    });
  });
});

describe('PricingPage Unlimited billing toggle', () => {
  it('renders the billing toggle with both options by default', () => {
    renderAt('/pricing');
    const group = screen.getByRole('radiogroup', { name: 'Billing cycle' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Monthly' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Yearly · save 33%' })
    ).toBeInTheDocument();
  });

  it('selects Monthly by default with the monthly hero price', () => {
    renderAt('/pricing');
    expect(screen.getByRole('radio', { name: 'Monthly' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByText('$7.99')).toBeInTheDocument();
    expect(
      screen.getByText('$7.99 billed today, then monthly')
    ).toBeInTheDocument();
  });

  it('switches the hero to the annual price and terms after selecting Yearly', () => {
    renderAt('/pricing');
    fireEvent.click(screen.getByRole('radio', { name: 'Yearly · save 33%' }));
    expect(screen.getByText('$5.33')).toBeInTheDocument();
    expect(
      screen.getByText('$64 billed today, then yearly · save 33%')
    ).toBeInTheDocument();
  });

  it('calls startUnlimitedCheckout with month by default', async () => {
    mockStartUnlimitedCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/month',
    });
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });

    renderAt('/pricing', { isLoggedIn: true });
    fireEvent.click(
      screen.getByRole('button', { name: 'Get Unlimited — billed monthly' })
    );

    await waitFor(() => {
      expect(mockStartUnlimitedCheckout).toHaveBeenCalledWith(
        'month',
        'minimal',
        'pricing_page'
      );
    });
  });

  it('calls startUnlimitedCheckout with year when Yearly is selected', async () => {
    mockStartUnlimitedCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/year',
    });
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });

    renderAt('/pricing', { isLoggedIn: true });
    fireEvent.click(screen.getByRole('radio', { name: 'Yearly · save 33%' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Get Unlimited — billed yearly' })
    );

    await waitFor(() => {
      expect(mockStartUnlimitedCheckout).toHaveBeenCalledWith(
        'year',
        'minimal',
        'pricing_page'
      );
    });
  });

  it('redirects to login when logged-out user clicks Upgrade', () => {
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      value: { href: '' },
    });
    renderAt('/pricing', { isLoggedIn: false });
    fireEvent.click(
      screen.getByRole('button', { name: 'Get Unlimited — billed monthly' })
    );
    expect(globalThis.location.href).toBe('/login?redirect=/pricing');
  });

  it('fires producer_entry_viewed once when the educators section is seen', async () => {
    const { track } = await import('../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    renderAt('/pricing');
    await waitFor(() =>
      expect(
        trackMock.mock.calls.filter(
          ([name]) => name === 'producer_entry_viewed'
        )
      ).toEqual([['producer_entry_viewed', { source: 'pricing_page' }]])
    );
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import PricingPage from './PricingPage';
import { track } from '../../lib/analytics/track';
import type { PricingEntitlement } from './components/OwnedPlanNotice';

const mockStartPassCheckout = vi.fn();
const mockStartUnlimitedCheckout = vi.fn();
const mockStartAutoSyncCheckout = vi.fn();
const mockGetAutoSyncPrice = vi.fn();

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    startPassCheckout: mockStartPassCheckout,
    startUnlimitedCheckout: mockStartUnlimitedCheckout,
    startAutoSyncCheckout: mockStartAutoSyncCheckout,
    getCheckoutPrices: () => Promise.resolve(null),
    getAutoSyncPrice: mockGetAutoSyncPrice,
  }),
}));

vi.mock('../../components/TopMessage/TopMessage', () => ({
  default: () => null,
}));

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

vi.mock('../../lib/hooks/useCardUsage', () => ({
  useCardUsage: () => null,
}));

const CONNECTOR_INTRO =
  "The deck you asked Claude or ChatGPT for went over the free plan's monthly limit, so it wasn't made. Any plan below removes the limit. Then ask for the deck again.";

const PLAN_TITLES = ['Day Pass', 'Pro', 'Week Pass', 'Semester Pass'];

const renderAt = (
  path: string,
  isLoggedIn = false,
  entitlement?: PricingEntitlement
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <PricingPage isLoggedIn={isLoggedIn} entitlement={entitlement} />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const planHeadings = () =>
  screen
    .queryAllByRole('heading', { level: 3 })
    .filter((heading) => PLAN_TITLES.includes(heading.textContent ?? ''));

const cardOf = (title: string) => {
  const heading = planHeadings().find((h) => h.textContent === title);
  return heading?.parentElement?.parentElement;
};

beforeEach(() => {
  vi.mocked(track).mockClear();
  mockStartPassCheckout.mockReset();
  mockStartUnlimitedCheckout.mockReset();
  mockStartAutoSyncCheckout.mockReset();
  mockGetAutoSyncPrice.mockResolvedValue(null);
  Object.defineProperty(globalThis, 'location', {
    writable: true,
    value: { href: '' },
  });
});

describe('PricingPage for a connector visitor (ref=mcp)', () => {
  it('orders the cards Day Pass, Pro, Week Pass, Semester Pass', () => {
    renderAt('/pricing/?ref=mcp');
    expect(planHeadings().map((h) => h.textContent)).toEqual(PLAN_TITLES);
  });

  it('features only the Day Pass', () => {
    renderAt('/pricing/?ref=mcp');
    const featured = PLAN_TITLES.filter((title) =>
      cardOf(title)?.className.includes('cardPro')
    );
    expect(featured).toEqual(['Day Pass']);
  });

  it('labels the second row as longer passes', () => {
    renderAt('/pricing/?ref=mcp');
    const label = screen.getByRole('heading', {
      level: 2,
      name: 'Longer passes',
    });
    const week = cardOf('Week Pass');
    expect(week).toBeDefined();
    expect(
      label.compareDocumentPosition(week as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.queryByText('Pay once — no subscription')
    ).not.toBeInTheDocument();
  });

  it('keeps the study-horizon captions and the Best value badge', () => {
    renderAt('/pricing/?ref=mcp');
    expect(screen.getByText('One study day')).toBeInTheDocument();
    expect(screen.getByText('One exam week')).toBeInTheDocument();
    expect(screen.getByText('A full term')).toBeInTheDocument();
    expect(
      screen.getByText('Best value').closest('div')?.textContent
    ).toContain('Semester Pass');
  });

  it('explains why the deck was not made', () => {
    renderAt('/pricing/?ref=mcp');
    expect(screen.getByText(CONNECTOR_INTRO)).toBeInTheDocument();
  });

  it('tags paywall_shown with the connector variant', () => {
    renderAt('/pricing/?ref=mcp');
    expect(track).toHaveBeenCalledWith('paywall_shown', {
      surface: 'pricing_page',
      variant: 'mcp-day-first',
    });
  });

  it('starts a Day Pass checkout tagged with the connector variant', async () => {
    mockStartPassCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.test/day',
    });
    renderAt('/pricing/?ref=mcp');

    fireEvent.click(screen.getByRole('button', { name: /^Get Day Pass · / }));

    expect(track).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'pricing_page',
      plan: 'day_pass',
      variant: 'mcp-day-first',
    });
    await waitFor(() =>
      expect(mockStartPassCheckout).toHaveBeenCalledWith(
        '24h',
        'mcp-day-first',
        'pricing_page'
      )
    );
  });

  it('starts nothing until the visitor picks a plan', () => {
    renderAt('/pricing/?ref=mcp');
    expect(mockStartPassCheckout).not.toHaveBeenCalled();
    expect(mockStartUnlimitedCheckout).not.toHaveBeenCalled();
    expect(mockStartAutoSyncCheckout).not.toHaveBeenCalled();
  });

  it('keeps ref=mcp through the sign-in redirect for a signed-out Pro click', () => {
    renderAt('/pricing/?ref=mcp');

    fireEvent.click(
      screen.getByRole('button', { name: 'Get Pro — billed monthly' })
    );

    expect(globalThis.location.href).toBe(
      `/login?redirect=${encodeURIComponent('/pricing?ref=mcp')}`
    );
    expect(mockStartUnlimitedCheckout).not.toHaveBeenCalled();
  });

  it('keeps ref=mcp and the yearly interval through the sign-in redirect', () => {
    renderAt('/pricing/?ref=mcp');

    fireEvent.click(screen.getByRole('radio', { name: /^Yearly/ }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Get Pro — billed yearly' })
    );

    expect(globalThis.location.href).toBe(
      `/login?redirect=${encodeURIComponent('/pricing?ref=mcp&interval=year')}`
    );
  });

  it('starts a signed-in Pro checkout tagged with the connector variant', async () => {
    mockStartUnlimitedCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.test/pro',
    });
    renderAt('/pricing/?ref=mcp', true);

    fireEvent.click(
      screen.getByRole('button', { name: 'Get Pro — billed monthly' })
    );

    await waitFor(() =>
      expect(mockStartUnlimitedCheckout).toHaveBeenCalledWith(
        'month',
        'mcp-day-first',
        'pricing_page',
        false
      )
    );
  });

  it('keeps ref=mcp through the sign-in redirect for a signed-out Auto Sync click', async () => {
    mockGetAutoSyncPrice.mockResolvedValue({
      display: '$9',
      interval: 'month',
    });
    renderAt('/pricing/?ref=mcp');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Get Auto Sync' })
    );

    expect(globalThis.location.href).toBe(
      `/login?redirect=${encodeURIComponent('/pricing?ref=mcp#auto-sync')}`
    );
  });
});

describe('PricingPage for a connector visitor who already owns ongoing access', () => {
  it('shows no plan cards', () => {
    renderAt('/pricing/?ref=mcp', true, { subscriber: true, passKind: null });
    expect(planHeadings()).toEqual([]);
    expect(screen.queryByText(CONNECTOR_INTRO)).not.toBeInTheDocument();
    expect(screen.queryByText('Longer passes')).not.toBeInTheDocument();
  });
});

describe('PricingPage without a connector ref', () => {
  it.each(['/pricing', '/pricing?ref=other'])(
    'shows no connector intro and no longer-passes row at %s',
    (path) => {
      renderAt(path);
      expect(screen.queryByText(CONNECTOR_INTRO)).not.toBeInTheDocument();
      expect(screen.queryByText('Longer passes')).not.toBeInTheDocument();
      expect(
        screen.getByText('Pay once — no subscription')
      ).toBeInTheDocument();
    }
  );

  it('tags paywall_shown with the default variant', () => {
    renderAt('/pricing');
    expect(track).toHaveBeenCalledWith('paywall_shown', {
      surface: 'pricing_page',
      variant: 'semester-first',
    });
  });

  it('redirects a signed-out Pro click back to plain /pricing', () => {
    renderAt('/pricing?source=paywall-cancel');

    fireEvent.click(
      screen.getByRole('button', { name: 'Get Pro — billed monthly' })
    );

    expect(globalThis.location.href).toBe(
      `/login?redirect=${encodeURIComponent('/pricing')}`
    );
  });
});

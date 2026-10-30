import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const SIGNED_OUT_CONNECTOR_INTRO =
  "The deck you asked Claude or ChatGPT for went over the free plan's monthly limit, so it wasn't made. Any plan below removes the limit. For a pass, enter your 2anki account email at checkout so it reaches the account you connected. Then ask for the deck again.";

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
  mockStartPassCheckout.mockResolvedValue({
    url: 'https://checkout.stripe.test/pass',
  });
  mockStartUnlimitedCheckout.mockResolvedValue({
    url: 'https://checkout.stripe.test/pro',
  });
  mockStartAutoSyncCheckout.mockResolvedValue({
    url: 'https://checkout.stripe.test/auto-sync',
  });
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

  it('puts Day Pass and Pro in the first row, Week and Semester in the second', () => {
    renderAt('/pricing/?ref=mcp');
    const firstRow = cardOf('Day Pass')?.parentElement;
    const secondRow = cardOf('Week Pass')?.parentElement;
    expect(cardOf('Pro')?.parentElement).toBe(firstRow);
    expect(cardOf('Semester Pass')?.parentElement).toBe(secondRow);
    expect(firstRow).not.toBe(secondRow);
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
  });

  it('drops the default pay-once section label', () => {
    renderAt('/pricing/?ref=mcp');
    expect(
      screen.queryByText('Pay once — no subscription')
    ).not.toBeInTheDocument();
  });

  it.each(['One study day', 'One exam week', 'A full term'])(
    'keeps the study-horizon caption %s',
    (caption) => {
      renderAt('/pricing/?ref=mcp');
      expect(screen.getByText(caption)).toBeInTheDocument();
    }
  );

  it('keeps the Best value badge on the Semester Pass', () => {
    renderAt('/pricing/?ref=mcp');
    const semester = cardOf('Semester Pass');
    expect(semester).toBeInstanceOf(HTMLElement);
    expect(
      within(semester as HTMLElement).getByText('Best value')
    ).toBeInTheDocument();
  });

  it('tells a signed-out visitor to enter their account email for a pass', () => {
    renderAt('/pricing/?ref=mcp');
    expect(screen.getByText(SIGNED_OUT_CONNECTOR_INTRO)).toBeInTheDocument();
    expect(screen.queryByText(CONNECTOR_INTRO)).not.toBeInTheDocument();
  });

  it('tags paywall_shown with the connector variant', () => {
    renderAt('/pricing/?ref=mcp');
    expect(track).toHaveBeenCalledWith('paywall_shown', {
      surface: 'pricing_page',
      variant: 'mcp-day-first',
    });
  });

  it('tags a signed-out Day Pass click with the connector variant', () => {
    renderAt('/pricing/?ref=mcp');

    fireEvent.click(screen.getByRole('button', { name: /^Get Day Pass · / }));

    expect(track).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'pricing_page',
      plan: 'day_pass',
      variant: 'mcp-day-first',
    });
  });

  it('starts a signed-out Day Pass checkout tagged with the connector variant', async () => {
    mockStartPassCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.test/day',
    });
    renderAt('/pricing/?ref=mcp');

    fireEvent.click(screen.getByRole('button', { name: /^Get Day Pass · / }));

    await waitFor(() =>
      expect(mockStartPassCheckout).toHaveBeenCalledWith(
        '24h',
        'mcp-day-first',
        'pricing_page'
      )
    );
  });

  it.each([
    ['a signed-out visitor', false],
    ['a visitor back from sign-in', true],
  ])('starts nothing for %s until a plan is picked', (_label, isLoggedIn) => {
    renderAt('/pricing?ref=mcp&interval=year', isLoggedIn);
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

describe('PricingPage for a signed-in free connector visitor', () => {
  const freeEntitlement: PricingEntitlement = {
    subscriber: false,
    passKind: null,
    passExpiresAt: null,
  };

  it('orders the cards Day Pass, Pro, Week Pass, Semester Pass', () => {
    renderAt('/pricing/?ref=mcp', true, freeEntitlement);
    expect(planHeadings().map((h) => h.textContent)).toEqual(PLAN_TITLES);
  });

  it('explains why the deck was not made', () => {
    renderAt('/pricing/?ref=mcp', true, freeEntitlement);
    expect(screen.getByText(CONNECTOR_INTRO)).toBeInTheDocument();
  });

  it('tags a Day Pass checkout with the connector variant', async () => {
    mockStartPassCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.test/day',
    });
    renderAt('/pricing/?ref=mcp', true, freeEntitlement);

    fireEvent.click(screen.getByRole('button', { name: /^Get Day Pass · / }));

    await waitFor(() =>
      expect(mockStartPassCheckout).toHaveBeenCalledWith(
        '24h',
        'mcp-day-first',
        'pricing_page'
      )
    );
  });
});

describe('PricingPage longer passes for a signed-in connector visitor', () => {
  it.each([
    ['7d', /^Get Week Pass · /],
    ['120d', /^Get Semester Pass · /],
  ])(
    'starts a %s checkout tagged with the connector variant',
    async (kind, name) => {
      mockStartPassCheckout.mockResolvedValue({
        url: 'https://checkout.stripe.test/pass',
      });
      renderAt('/pricing/?ref=mcp', true, { subscriber: false });

      fireEvent.click(screen.getByRole('button', { name }));

      await waitFor(() =>
        expect(mockStartPassCheckout).toHaveBeenCalledWith(
          kind,
          'mcp-day-first',
          'pricing_page'
        )
      );
    }
  );
});

describe('PricingPage for a connector visitor who already owns ongoing access', () => {
  it.each<[string, PricingEntitlement]>([
    ['Pro', { subscriber: true, passKind: null }],
    ['Lifetime', { patreon: true }],
    ['Apple', { subscriber: true, planSource: 'apple' }],
  ])('shows a %s owner no plan cards and no intro', (_label, entitlement) => {
    renderAt('/pricing/?ref=mcp', true, entitlement);
    expect(planHeadings()).toEqual([]);
    expect(screen.queryByText(CONNECTOR_INTRO)).not.toBeInTheDocument();
    expect(screen.queryByText('Longer passes')).not.toBeInTheDocument();
  });
});

describe('PricingPage for a connector visitor holding an active pass', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the cards without the over-the-limit intro', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
    renderAt('/pricing/?ref=mcp', true, {
      subscriber: true,
      passKind: '7d',
      passExpiresAt: '2026-11-02T12:00:00Z',
    });
    expect(planHeadings().map((h) => h.textContent)).toEqual(PLAN_TITLES);
    expect(screen.queryByText(CONNECTOR_INTRO)).not.toBeInTheDocument();
  });

  it('hides the signed-out intro from a pass bought without an account', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
    renderAt('/pricing/?ref=mcp', false, {
      passKind: '24h',
      passExpiresAt: '2026-10-31T12:00:00Z',
    });
    expect(planHeadings().map((h) => h.textContent)).toEqual(PLAN_TITLES);
    expect(
      screen.queryByText(SIGNED_OUT_CONNECTOR_INTRO)
    ).not.toBeInTheDocument();
  });
});

describe('PricingPage without a connector ref', () => {
  it.each(['/pricing', '/pricing?ref=other'])(
    'shows no connector intro and no longer-passes row at %s',
    (path) => {
      renderAt(path);
      expect(screen.queryByText(CONNECTOR_INTRO)).not.toBeInTheDocument();
      expect(
        screen.queryByText(SIGNED_OUT_CONNECTOR_INTRO)
      ).not.toBeInTheDocument();
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

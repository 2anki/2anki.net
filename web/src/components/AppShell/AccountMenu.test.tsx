import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { track } from '../../lib/analytics/track';
import { getCardUsage } from '../../lib/backend/getCardUsage';
import { getAiCredits } from '../../lib/backend/getAiCredits';
import { getSubscriptionStatus } from '../../lib/backend/getSubscriptionStatus';
import { STRIPE_CUSTOMER_PORTAL_URL } from '../../lib/stripePortal';
import { AccountMenu } from './AccountMenu';

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

vi.mock('../../lib/backend/getCardUsage', () => ({
  getCardUsage: vi.fn().mockResolvedValue({
    cards_used: 23,
    cards_limit: 100,
    unlimited: false,
  }),
}));

vi.mock('../../lib/backend/getAiCredits', () => ({
  getAiCredits: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/backend/getSubscriptionStatus', () => ({
  getSubscriptionStatus: vi.fn().mockResolvedValue({ subscriptions: [] }),
}));

const stripeSubscription = (status: string) => ({
  id: 'sub_test',
  status,
  created: null,
  cancel_at_period_end: false,
  cancel_at: null,
  canceled_at: status === 'canceled' ? 1 : null,
  current_period_end: null,
  paused_until: null,
  cancellation_reason: null,
  plan: { amount: 799, currency: 'usd', interval: 'month' },
});

const lapsedLocals = {
  patreon: false,
  subscriber: false,
  subscriptionInfo: { email: 'payer@example.com' },
};

interface RenderOpts {
  email?: string | null;
  locals?: {
    patreon?: boolean;
    subscriber?: boolean;
    autoSyncActive?: boolean;
    passKind?: '24h' | '7d' | '120d' | 'unlimited' | null;
    planSource?: 'stripe' | 'apple' | 'lifetime' | null;
    subscriptionInfo?: { email?: string | null } | null;
  } | null;
  onLogOut?: (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => void;
}

function renderMenu({
  email = 'alexander@alemayhu.com',
  locals = { patreon: false, subscriber: false },
  onLogOut = vi.fn(),
}: RenderOpts = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/upload']}>
        <AccountMenu email={email} locals={locals} onLogOut={onLogOut} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /^Account menu/ }));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(track).mockClear();
  vi.mocked(getCardUsage).mockClear();
  vi.mocked(getAiCredits).mockReset();
  vi.mocked(getAiCredits).mockResolvedValue(null);
  vi.mocked(getSubscriptionStatus).mockReset();
  vi.mocked(getSubscriptionStatus).mockResolvedValue({ subscriptions: [] });
});

describe('AccountMenu trigger', () => {
  it('renders a closed avatar button with the email initial', () => {
    renderMenu();
    const button = screen.getByRole('button', { name: /^Account menu/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent('A');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on click, tracks the open, and closes on Escape', () => {
    renderMenu();
    openMenu();
    expect(screen.getByRole('dialog', { name: /^Account menu/ })).toBeVisible();
    expect(track).toHaveBeenCalledWith('account_menu_opened');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when clicking outside the menu', () => {
    renderMenu();
    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('AccountMenu balance ring', () => {
  it('draws the cards left this month for a free user and describes it on the button', async () => {
    renderMenu();
    const ring = await screen.findByTestId('avatar-balance-ring');
    expect(ring).toHaveAttribute('data-kind', 'cards');
    expect(ring).toHaveAttribute('data-fraction', '0.77');
    expect(ring).toHaveAttribute('data-low', 'false');
    expect(
      screen.getByRole('button', {
        name: 'Account menu. 77 / 100 cards left this month',
      })
    ).toBeInTheDocument();
  });

  it('turns low once under a fifth of the monthly cards remain', async () => {
    vi.mocked(getCardUsage).mockResolvedValueOnce({
      cards_used: 85,
      cards_limit: 100,
      unlimited: false,
    });
    renderMenu();
    const ring = await screen.findByTestId('avatar-balance-ring');
    expect(ring).toHaveAttribute('data-fraction', '0.15');
    expect(ring).toHaveAttribute('data-low', 'true');
  });

  it('draws AI credits left for a subscriber with a usable balance', async () => {
    vi.mocked(getAiCredits).mockResolvedValue({
      credits: 125,
      used: 375,
      allowance: 500,
      usable: true,
      windowEnd: null,
      resets: 'period',
    });
    renderMenu({ locals: { subscriber: true } });
    const ring = await screen.findByTestId('avatar-balance-ring');
    expect(ring).toHaveAttribute('data-kind', 'aiCredits');
    expect(ring).toHaveAttribute('data-fraction', '0.25');
    expect(
      screen.getByRole('button', {
        name: 'Account menu. 125 AI credits left.',
      })
    ).toBeInTheDocument();
  });

  it('sizes a pack without an allowance by what was bought', async () => {
    vi.mocked(getAiCredits).mockResolvedValue({
      credits: 100,
      used: 150,
      allowance: 0,
      usable: true,
      windowEnd: '2026-12-01T00:00:00.000Z',
      resets: 'pass',
    });
    renderMenu({ locals: { patreon: true } });
    const ring = await screen.findByTestId('avatar-balance-ring');
    expect(ring).toHaveAttribute('data-kind', 'aiCredits');
    expect(ring).toHaveAttribute('data-fraction', '0.40');
  });

  it('draws no ring for a lifetime user without AI credits', async () => {
    renderMenu({ locals: { patreon: true } });
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('avatar-balance-ring')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Account menu/ })
    ).toBeInTheDocument();
  });

  it('draws no ring for a paused pack that cannot be used', async () => {
    vi.mocked(getAiCredits).mockResolvedValue({
      credits: 120,
      used: 0,
      allowance: 0,
      usable: false,
      windowEnd: '2026-12-01T00:00:00.000Z',
      resets: 'pass',
    });
    renderMenu({ locals: { patreon: true } });
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('avatar-balance-ring')).not.toBeInTheDocument();
  });
});

describe('AccountMenu header and balance', () => {
  it('renders the email and plan label', () => {
    renderMenu({ locals: { patreon: true } });
    openMenu();
    expect(screen.getByText('alexander@alemayhu.com')).toBeInTheDocument();
    expect(screen.getByText('Lifetime')).toBeInTheDocument();
  });

  it('shows Free with the usage counter and an Upgrade button for free users', async () => {
    renderMenu();
    openMenu();
    expect(screen.getByText('Free')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('23')).toBeInTheDocument());
    expect(screen.getByText('/ 100 cards this month')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute(
      'href',
      '/pricing?from=avatar'
    );
  });

  it('tracks the avatar upgrade click', () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('link', { name: 'Upgrade' }));
    expect(track).toHaveBeenCalledWith('upgrade_clicked', { source: 'avatar' });
  });

  it('shows Unlimited cards and Manage subscription for a subscriber, no Upgrade', async () => {
    renderMenu({ locals: { subscriber: true } });
    openMenu();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Unlimited cards')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Manage subscription' })
    ).toHaveAttribute('href', '/account');
    expect(
      screen.queryByRole('link', { name: 'Upgrade' })
    ).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 10));
    expect(getCardUsage).not.toHaveBeenCalled();
  });

  it('shows Unlimited cards without a subscription link for a lifetime user', () => {
    renderMenu({ locals: { patreon: true } });
    openMenu();
    expect(screen.getByText('Unlimited cards')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Manage subscription' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Upgrade' })
    ).not.toBeInTheDocument();
  });

  it('does not call getCardUsage when locals is null (unauthenticated visitor)', async () => {
    renderMenu({ locals: null });
    await new Promise((r) => setTimeout(r, 10));
    expect(getCardUsage).not.toHaveBeenCalled();
  });
});

describe('AccountMenu AI credits line', () => {
  it('renders nothing when the fetch resolves null', async () => {
    renderMenu();
    openMenu();
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText(/AI credit/)).not.toBeInTheDocument();
  });

  it('renders nothing for a free user with no plan (the real zero-allowance shape)', async () => {
    vi.mocked(getAiCredits).mockResolvedValue({
      credits: 0,
      used: 0,
      allowance: 0,
      usable: false,
      windowEnd: null,
      resets: 'month',
    });
    renderMenu();
    openMenu();
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText(/AI credit/)).not.toBeInTheDocument();
  });

  it('shows the balance for a subscriber with credits', async () => {
    vi.mocked(getAiCredits).mockResolvedValue({
      credits: 312,
      used: 0,
      allowance: 500,
      usable: true,
      windowEnd: null,
      resets: 'period',
    });
    renderMenu({ locals: { subscriber: true } });
    openMenu();
    await waitFor(() =>
      expect(screen.getByText('312 AI credits left.')).toBeInTheDocument()
    );
    expect(
      screen.queryByRole('link', { name: 'Top up — $5' })
    ).not.toBeInTheDocument();
  });

  it('shows a buy-credits link when the balance is low and tracks the click', async () => {
    vi.mocked(getAiCredits).mockResolvedValue({
      credits: 10,
      used: 490,
      allowance: 500,
      usable: true,
      windowEnd: null,
      resets: 'period',
    });
    renderMenu({ locals: { subscriber: true } });
    openMenu();
    const link = await screen.findByRole('link', { name: 'Top up — $5' });
    expect(link).toHaveAttribute('href', '/account');
    fireEvent.click(link);
    expect(track).toHaveBeenCalledWith('credits_sidebar_link_clicked');
  });

  it('shows the zero-state copy with a buy link when exhausted', async () => {
    vi.mocked(getAiCredits).mockResolvedValue({
      credits: 0,
      used: 500,
      allowance: 500,
      usable: true,
      windowEnd: null,
      resets: 'period',
    });
    renderMenu({ locals: { subscriber: true } });
    openMenu();
    await waitFor(() =>
      expect(
        screen.getByText(/Your next deck builds without AI/)
      ).toBeInTheDocument()
    );
    expect(
      screen.getByRole('link', { name: 'Top up — $5' })
    ).toBeInTheDocument();
  });

  it.each([
    {
      resets: 'period' as const,
      line: '0 AI credits left. Your next deck builds without AI until your credits reset.',
    },
    {
      resets: 'pass' as const,
      line: '0 AI credits left. Your next deck builds without AI.',
    },
  ])(
    'names a reset only for credits that reset by $resets',
    async ({ resets, line }) => {
      vi.mocked(getAiCredits).mockResolvedValue({
        credits: 0,
        used: 500,
        allowance: 500,
        usable: true,
        windowEnd: null,
        resets,
      });
      renderMenu({ locals: { subscriber: true } });
      openMenu();
      await waitFor(() => expect(screen.getByText(line)).toBeInTheDocument());
    }
  );

  it('shows a paused balance for a lapsed plan with an unexpired pack, no buy link', async () => {
    vi.mocked(getAiCredits).mockResolvedValue({
      credits: 120,
      used: 0,
      allowance: 0,
      usable: false,
      windowEnd: '2026-12-01T00:00:00.000Z',
      resets: 'pass',
    });
    renderMenu();
    openMenu();
    await waitFor(() =>
      expect(screen.getByText(/120 AI credits, paused/)).toBeInTheDocument()
    );
    expect(
      screen.queryByRole('link', { name: 'Top up — $5' })
    ).not.toBeInTheDocument();
  });

  it('does not call getAiCredits when locals is null (unauthenticated visitor)', async () => {
    renderMenu({ locals: null });
    await new Promise((r) => setTimeout(r, 10));
    expect(getAiCredits).not.toHaveBeenCalled();
  });
});

describe('AccountMenu links', () => {
  it('lists account, card settings, docs, what is new, contact, about, terms and privacy', () => {
    renderMenu();
    openMenu();
    const expected: [string, string][] = [
      ['Account', '/account'],
      ['Card settings', '/card-options'],
      ['Docs', '/documentation'],
      ["What's new", '/whats-new'],
      ['Contact', '/contact'],
      ['About', '/about'],
      ['Terms', '/documentation/reference/terms'],
      ['Privacy', '/documentation/reference/privacy'],
    ];
    for (const [name, href] of expected) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });

  it('renders the theme switcher and language picker inside the menu', () => {
    renderMenu();
    openMenu();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
    expect(screen.getByRole('combobox')).toBeVisible();
  });

  it('closes the menu after a link is clicked', () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('link', { name: 'Account' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fires onLogOut when Log out is clicked', () => {
    const onLogOut = vi.fn();
    renderMenu({ onLogOut });
    openMenu();
    fireEvent.click(screen.getByRole('link', { name: /log out/i }));
    expect(onLogOut).toHaveBeenCalledTimes(1);
  });
});

describe('AccountMenu after a failed renewal', () => {
  it.each(['past_due', 'unpaid'])(
    'shows the failed payment instead of Free for a %s subscription',
    async (status) => {
      vi.mocked(getSubscriptionStatus).mockResolvedValue({
        subscriptions: [stripeSubscription(status)],
      });
      renderMenu({ locals: lapsedLocals });
      openMenu();

      expect(await screen.findByText('Payment failed')).toBeVisible();
      expect(screen.queryByText('Free')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'Upgrade' })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Update payment details' })
      ).toHaveAttribute('href', STRIPE_CUSTOMER_PORTAL_URL);
    }
  );

  it('shows the failed payment for an Auto Sync plan', async () => {
    vi.mocked(getSubscriptionStatus).mockResolvedValue({
      subscriptions: [
        {
          ...stripeSubscription('past_due'),
          plan: { amount: 1900, currency: 'usd', interval: 'month' },
        },
      ],
    });
    renderMenu({ locals: lapsedLocals });
    openMenu();

    expect(await screen.findByText('Payment failed')).toBeVisible();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
  });

  it.each([
    ['paused', { ...stripeSubscription('active'), paused_until: 1893456000 }],
    ['incomplete', stripeSubscription('incomplete')],
  ])('keeps Free and Upgrade for a %s subscription', async (_kind, sub) => {
    vi.mocked(getSubscriptionStatus).mockResolvedValue({
      subscriptions: [sub],
    });
    renderMenu({ locals: lapsedLocals });
    openMenu();

    expect(await screen.findByText('Free')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Upgrade' })).toBeVisible();
    expect(screen.queryByText('Payment failed')).not.toBeInTheDocument();
  });

  it('keeps Free and Upgrade when Stripe has an active plan the account row marks inactive', async () => {
    vi.mocked(getSubscriptionStatus).mockResolvedValue({
      subscriptions: [
        stripeSubscription('active'),
        { ...stripeSubscription('past_due'), id: 'sub_lapsed' },
      ],
    });
    renderMenu({ locals: lapsedLocals });
    openMenu();

    expect(await screen.findByText('Free')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Upgrade' })).toBeVisible();
    expect(screen.queryByText('Payment failed')).not.toBeInTheDocument();
  });

  it('tracks the click on Update payment details', async () => {
    vi.mocked(getSubscriptionStatus).mockResolvedValue({
      subscriptions: [stripeSubscription('past_due')],
    });
    renderMenu({ locals: lapsedLocals });
    openMenu();

    fireEvent.click(
      await screen.findByRole('link', { name: 'Update payment details' })
    );

    expect(track).toHaveBeenCalledWith('subscription_manage_billing_clicked', {
      from: 'past_due',
      surface: 'account_menu',
    });
  });

  it('records that the failed payment was shown in the menu', async () => {
    vi.mocked(getSubscriptionStatus).mockResolvedValue({
      subscriptions: [stripeSubscription('past_due')],
    });
    renderMenu({ locals: lapsedLocals });
    openMenu();

    await screen.findByText('Payment failed');

    expect(track).toHaveBeenCalledWith('subscription_past_due_shown', {
      subscription_id: 'sub_test',
      surface: 'account_menu',
    });
  });

  it('records the failed payment once across repeat opens', async () => {
    vi.mocked(getSubscriptionStatus).mockResolvedValue({
      subscriptions: [stripeSubscription('past_due')],
    });
    renderMenu({ locals: lapsedLocals });
    openMenu();
    await screen.findByText('Payment failed');

    fireEvent.keyDown(document, { key: 'Escape' });
    openMenu();
    await screen.findByText('Payment failed');

    const shown = vi
      .mocked(track)
      .mock.calls.filter(([name]) => name === 'subscription_past_due_shown');
    expect(shown).toHaveLength(1);
  });

  it('shows neither Free nor Upgrade while the subscription is being read', async () => {
    vi.mocked(getSubscriptionStatus).mockReturnValue(new Promise(() => {}));
    renderMenu({ locals: lapsedLocals });
    openMenu();

    await waitFor(() => expect(getSubscriptionStatus).toHaveBeenCalled());
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Upgrade' })
    ).not.toBeInTheDocument();
  });

  it('does not read Stripe until the menu is opened', () => {
    renderMenu({ locals: lapsedLocals });

    expect(getSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('keeps Free and Upgrade for someone who has never paid, with no Stripe read', () => {
    renderMenu({
      locals: {
        patreon: false,
        subscriber: false,
        subscriptionInfo: { active: false } as { email?: string | null },
      },
    });
    openMenu();

    expect(getSubscriptionStatus).not.toHaveBeenCalled();
    expect(screen.getByText('Free')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Upgrade' })).toBeVisible();
  });

  it('keeps Free and Upgrade for a former subscriber who cancelled', async () => {
    vi.mocked(getSubscriptionStatus).mockResolvedValue({
      subscriptions: [stripeSubscription('canceled')],
    });
    renderMenu({ locals: lapsedLocals });
    openMenu();

    expect(await screen.findByText('Free')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Upgrade' })).toBeVisible();
    expect(screen.queryByText('Payment failed')).not.toBeInTheDocument();
  });

  it('keeps Free and Upgrade for someone who has never paid and is over the limit', async () => {
    vi.mocked(getCardUsage).mockResolvedValueOnce({
      cards_used: 100,
      cards_limit: 100,
      unlimited: false,
    });
    renderMenu({ locals: { patreon: false, subscriber: false } });
    openMenu();

    expect(await screen.findByText('100')).toBeVisible();
    expect(getSubscriptionStatus).not.toHaveBeenCalled();
    expect(screen.getByText('Free')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Upgrade' })).toBeVisible();
  });

  it('shows the failed payment to a lapsed subscriber who is over the limit', async () => {
    vi.mocked(getCardUsage).mockResolvedValueOnce({
      cards_used: 100,
      cards_limit: 100,
      unlimited: false,
    });
    vi.mocked(getSubscriptionStatus).mockResolvedValue({
      subscriptions: [stripeSubscription('past_due')],
    });
    renderMenu({ locals: lapsedLocals });
    openMenu();

    expect(await screen.findByText('100')).toBeVisible();
    expect(await screen.findByText('Payment failed')).toBeVisible();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
  });

  it('falls back to Free and Upgrade when the read fails', async () => {
    vi.mocked(getSubscriptionStatus).mockRejectedValue(new Error('offline'));
    renderMenu({ locals: lapsedLocals });
    openMenu();

    expect(await screen.findByText('Free')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Upgrade' })).toBeVisible();
  });

  it.each([
    ['a subscriber', { subscriber: true, patreon: false }, 'Pro'],
    [
      'an active Auto Sync subscriber',
      { subscriber: true, patreon: false, autoSyncActive: true },
      'Pro',
    ],
    [
      'a pass holder with a lapsed plan',
      { subscriber: true, patreon: false, passKind: '7d' as const },
      'Pro',
    ],
    [
      'an Apple subscriber with a lapsed plan',
      { subscriber: true, patreon: false, planSource: 'apple' as const },
      'Pro',
    ],
    ['a lifetime holder', { subscriber: false, patreon: true }, 'Lifetime'],
  ])('does not read Stripe for %s', (_who, locals, label) => {
    renderMenu({
      locals: { ...locals, subscriptionInfo: { email: 'payer@example.com' } },
    });
    openMenu();

    expect(getSubscriptionStatus).not.toHaveBeenCalled();
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByText('Payment failed')).not.toBeInTheDocument();
  });
});

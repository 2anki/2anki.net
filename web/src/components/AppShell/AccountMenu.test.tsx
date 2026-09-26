import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { track } from '../../lib/analytics/track';
import { getCardUsage } from '../../lib/backend/getCardUsage';
import { getAiCredits } from '../../lib/backend/getAiCredits';
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

interface RenderOpts {
  email?: string | null;
  locals?: {
    patreon?: boolean;
    subscriber?: boolean;
    autoSyncActive?: boolean;
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
  fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(track).mockClear();
  vi.mocked(getCardUsage).mockClear();
  vi.mocked(getAiCredits).mockReset();
  vi.mocked(getAiCredits).mockResolvedValue(null);
});

describe('AccountMenu trigger', () => {
  it('renders a closed avatar button with the email initial', () => {
    renderMenu();
    const button = screen.getByRole('button', { name: 'Account menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent('A');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on click, tracks the open, and closes on Escape', () => {
    renderMenu();
    openMenu();
    expect(screen.getByRole('dialog', { name: 'Account menu' })).toBeVisible();
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

  it('shows a usage badge once a free user is near the monthly limit', async () => {
    vi.mocked(getCardUsage).mockResolvedValueOnce({
      cards_used: 85,
      cards_limit: 100,
      unlimited: false,
    });
    renderMenu();
    expect(await screen.findByTestId('avatar-usage-badge')).toBeInTheDocument();
  });

  it('shows no badge well under the limit', async () => {
    renderMenu();
    await waitFor(() => expect(getCardUsage).toHaveBeenCalled());
    expect(screen.queryByTestId('avatar-usage-badge')).not.toBeInTheDocument();
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
      ['Terms', '/documentation/misc/terms-of-service'],
      ['Privacy', '/documentation/misc/privacy-policy'],
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

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getAiCredits } from '../../lib/backend/getAiCredits';
import { getAiGift } from '../../lib/backend/aiGift';
import { TopBar } from './TopBar';
import { formatGiftDate } from '../AiGift/formatGiftDate';

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

const session = vi.hoisted(() => ({
  locals: { patreon: false, subscriber: false } as Record<string, unknown>,
}));

vi.mock('../../lib/backend/getUserLocals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/backend/getUserLocals')>()),
  getUserLocals: vi.fn(async () => ({
    user: { id: 5 },
    locals: session.locals,
    claudeCardsByDefault: false,
  })),
}));

vi.mock('../../lib/backend/aiGift', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/backend/aiGift')>()),
  getAiGift: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(getAiCredits).mockReset();
  vi.mocked(getAiCredits).mockResolvedValue(null);
  vi.mocked(getAiGift).mockReset();
  vi.mocked(getAiGift).mockResolvedValue({
    state: 'closed',
    feedbackDue: false,
  });
});

function renderTopBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const props = {
    email: 'reader@example.com',
    locals: { patreon: false, subscriber: false },
    onLogOut: vi.fn(),
    isDrawerOpen: false,
    onOpenDrawer: vi.fn(),
    onCloseDrawer: vi.fn(),
    ...overrides,
  };
  session.locals = { ...props.locals };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/upload']}>
        <TopBar {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return props;
}

function getMobileBurger() {
  return screen.getByLabelText('Open navigation', { selector: 'button' });
}

function getMobileLogo() {
  return screen.getByLabelText('2anki home', { selector: 'a' });
}

describe('TopBar', () => {
  it('renders the burger, the home logo and the account menu trigger', () => {
    renderTopBar();
    expect(getMobileBurger()).toHaveAttribute(
      'aria-controls',
      'app-sidebar-drawer'
    );
    expect(getMobileLogo()).toHaveAttribute('href', '/');
    expect(
      screen.getByRole('button', { name: /^Account menu/ })
    ).toBeInTheDocument();
  });

  it('hides the mobile burger and logo at desktop width, keeping the account menu', () => {
    renderTopBar();
    expect(getMobileBurger()).not.toBeVisible();
    expect(getMobileLogo()).not.toBeVisible();
    expect(screen.getByRole('button', { name: /^Account menu/ })).toBeVisible();
  });

  it('opens the drawer when closed and closes it when open', () => {
    const closed = renderTopBar();
    fireEvent.click(getMobileBurger());
    expect(closed.onOpenDrawer).toHaveBeenCalledTimes(1);
    expect(closed.onCloseDrawer).not.toHaveBeenCalled();
  });

  it('reports the drawer state on the burger and closes an open drawer', () => {
    const open = renderTopBar({ isDrawerOpen: true });
    const burger = getMobileBurger();
    expect(burger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(burger);
    expect(open.onCloseDrawer).toHaveBeenCalledTimes(1);
  });

  it('passes the account through to the menu', () => {
    renderTopBar({ locals: { patreon: true } });
    fireEvent.click(screen.getByRole('button', { name: /^Account menu/ }));
    expect(screen.getByText('reader@example.com')).toBeInTheDocument();
    expect(screen.getByText('Lifetime')).toBeInTheDocument();
  });
});

describe('TopBar free AI credits pill', () => {
  const claimed = {
    state: 'claimed' as const,
    credits: 70,
    hasCredits: true,
    expiresAt: '2026-12-02T12:00:00.000Z',
    firstUsed: true,
    validDays: 7,
    endsAt: '2026-12-04T22:00:00.000Z',
    feedbackDue: false,
  };

  it('shows the credits left, with when they run out, only while the account has gift credits', async () => {
    vi.mocked(getAiGift).mockResolvedValue(claimed);
    renderTopBar();

    expect(await screen.findByText('70 credits')).toBeInTheDocument();
    expect(
      screen.getByText(
        `Free AI credits, valid until ${formatGiftDate(claimed.expiresAt, 'en')}`
      )
    ).toBeInTheDocument();
  });

  it('says the clock starts at the first AI deck for credits not yet used', async () => {
    vi.mocked(getAiGift).mockResolvedValue({
      state: 'open',
      credits: 100,
      hasCredits: true,
      validDays: 7,
      endsAt: '2026-12-04T22:00:00.000Z',
      feedbackDue: false,
    });
    renderTopBar();

    expect(await screen.findByText('100 credits')).toBeInTheDocument();
    expect(
      screen.getByText(
        `Free AI credits, valid 7 days from your first AI deck and until ${formatGiftDate('2026-12-04T22:00:00.000Z', 'en')} at the latest`
      )
    ).toBeInTheDocument();
  });

  it.each([
    ['the gift is closed', { state: 'closed' as const, feedbackDue: false }],
    ['the gift total is full', { state: 'full' as const, feedbackDue: false }],
    ['the credits are used up', { ...claimed, credits: 0, hasCredits: false }],
  ])('shows no pill when %s', async (_case, status) => {
    vi.mocked(getAiGift).mockResolvedValue(status);
    renderTopBar();

    await waitFor(() => expect(getAiGift).toHaveBeenCalled());
    expect(screen.queryByText(/credits$/)).toBeNull();
  });

  it('never shows a gift icon or the old present button', async () => {
    vi.mocked(getAiGift).mockResolvedValue(claimed);
    renderTopBar();

    await screen.findByText('70 credits');
    expect(
      screen.queryByRole('button', { name: 'Free AI credits gift' })
    ).toBeNull();
  });
});

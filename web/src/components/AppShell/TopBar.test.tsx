import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getAiCredits } from '../../lib/backend/getAiCredits';
import { getAiGift } from '../../lib/backend/aiGift';
import { TopBar } from './TopBar';

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

describe('TopBar gift panel spending order', () => {
  const planCredits = (allowance: number) => ({
    credits: allowance,
    used: 0,
    allowance,
    usable: allowance > 0,
    windowEnd: null,
    resets: 'period' as const,
  });

  beforeEach(() => {
    vi.mocked(getAiGift).mockResolvedValue({
      state: 'claimed',
      credits: 100,
      expiresAt: '2099-11-26T19:15:00.000Z',
      feedbackDue: false,
    });
  });

  const openGift = async () =>
    fireEvent.click(
      await screen.findByRole('button', { name: 'Free AI credits gift' })
    );

  it('says plan credits go first for a paying account with an allowance', async () => {
    vi.mocked(getAiCredits).mockResolvedValue(planCredits(300));
    renderTopBar({ locals: { patreon: true } });
    await openGift();
    expect(
      await screen.findByText('Your plan credits are used first.')
    ).toBeInTheDocument();
  });

  it.each([
    [
      'a free account',
      { patreon: false, subscriber: false },
      300,
      /100 free AI credits left until/,
    ],
    [
      'a paying account with no allowance',
      { patreon: true },
      0,
      'You have 100 AI credits from the gift.',
    ],
  ])(
    'says nothing about spending order for %s',
    async (_name, locals, allowance, giftLine) => {
      vi.mocked(getAiCredits).mockResolvedValue(planCredits(allowance));
      renderTopBar({ locals });
      await openGift();
      expect(await screen.findByText(giftLine)).toBeInTheDocument();
      expect(
        screen.queryByText('Your plan credits are used first.')
      ).toBeNull();
    }
  );
});

describe('TopBar gift panel for an account with no plan', () => {
  const claimedWith = (fields: Record<string, unknown>) => {
    localStorage.clear();
    vi.mocked(getAiGift).mockResolvedValue({
      state: 'claimed',
      credits: 100,
      expiresAt: '2099-11-26T19:15:00.000Z',
      feedbackDue: false,
      inUse: false,
      minMonthlyCards: 20,
      ...fields,
    });
  };

  const openPanel = async () => {
    renderTopBar({ locals: { patreon: false, subscriber: false } });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Free AI credits gift' })
    );
    await screen.findByText(/100 free AI credits left until/);
  };

  it('promises Claude for the next PDF when the gift turns it on by default', async () => {
    claimedWith({
      claudeDefaultForPdf: true,
      aiBudgetAvailable: true,
      monthlyCardsLeft: 80,
    });
    await openPanel();

    expect(
      screen.getByText(
        'Claude will write the cards for your next PDF or PowerPoint file.'
      )
    ).toBeInTheDocument();
  });

  it('promises nothing when the status could not read the month', async () => {
    claimedWith({
      claudeDefaultForPdf: null,
      aiBudgetAvailable: null,
      monthlyCardsLeft: null,
    });
    await openPanel();

    expect(screen.queryByText(/Claude will write/)).toBeNull();
  });
});

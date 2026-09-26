import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

describe('TopBar', () => {
  it('renders the burger, the home logo and the account menu trigger', () => {
    renderTopBar();
    expect(
      screen.getByRole('button', { name: 'Open navigation' })
    ).toHaveAttribute('aria-controls', 'app-sidebar-drawer');
    expect(screen.getByRole('link', { name: '2anki home' })).toHaveAttribute(
      'href',
      '/'
    );
    expect(
      screen.getByRole('button', { name: 'Account menu' })
    ).toBeInTheDocument();
  });

  it('opens the drawer when closed and closes it when open', () => {
    const closed = renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(closed.onOpenDrawer).toHaveBeenCalledTimes(1);
    expect(closed.onCloseDrawer).not.toHaveBeenCalled();
  });

  it('reports the drawer state on the burger and closes an open drawer', () => {
    const open = renderTopBar({ isDrawerOpen: true });
    const burger = screen.getByRole('button', { name: 'Open navigation' });
    expect(burger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(burger);
    expect(open.onCloseDrawer).toHaveBeenCalledTimes(1);
  });

  it('passes the account through to the menu', () => {
    renderTopBar({ locals: { patreon: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.getByText('reader@example.com')).toBeInTheDocument();
    expect(screen.getByText('Lifetime')).toBeInTheDocument();
  });
});

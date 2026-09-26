import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import * as get2ankiApiModule from '../../lib/backend/get2ankiApi';
import { AppShell } from './AppShell';

function withClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

interface RenderOpts {
  pathname?: string;
  isLoggedIn: boolean | undefined;
}

function renderShell({ pathname = '/', isLoggedIn }: RenderOpts) {
  return render(
    withClient(
      <MemoryRouter initialEntries={[pathname]}>
        <AppShell
          isLoggedIn={isLoggedIn}
          email="alexander@alemayhu.com"
          locals={{ patreon: false, subscriber: false }}
          features={{ kiUI: false, ops: false }}
        >
          <div data-testid="page-content">page</div>
        </AppShell>
      </MemoryRouter>
    )
  );
}

describe('AppShell layout switch', () => {
  it('renders the top-bar navigation for anonymous visitors', () => {
    renderShell({ isLoggedIn: false, pathname: '/' });
    expect(
      screen.getByRole('navigation', { name: /main/i })
    ).toBeInTheDocument();
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();
  });

  it('renders the sidebar layout for logged-in users on app routes', () => {
    renderShell({ isLoggedIn: true, pathname: '/upload' });
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: /main/i })
    ).not.toBeInTheDocument();
  });

  it('forces the top-bar layout on /login even when logged in', () => {
    renderShell({ isLoggedIn: true, pathname: '/login' });
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();
  });

  it('forces the top-bar layout on /register even when logged in', () => {
    renderShell({ isLoggedIn: true, pathname: '/register' });
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();
  });

  it('forces the top-bar layout on /forgot even when logged in', () => {
    renderShell({ isLoggedIn: true, pathname: '/forgot' });
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();
  });

  it('forces the top-bar layout on a password reset link even when logged in', () => {
    renderShell({ isLoggedIn: true, pathname: '/users/r/abc-123' });
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();
  });

  it('always renders the page content', () => {
    renderShell({ isLoggedIn: true, pathname: '/upload' });
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });
});

describe('AppShell logout', () => {
  let logoutSpy: ReturnType<typeof vi.fn>;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logoutSpy = vi.fn();
    vi.spyOn(get2ankiApiModule, 'get2ankiApi').mockReturnValue({
      logout: logoutSpy,
      getCheckoutPrices: vi.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof get2ankiApiModule.get2ankiApi>);
    confirmSpy = vi.spyOn(globalThis, 'confirm');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls logout immediately when the Log out link is clicked', () => {
    render(
      withClient(
        <MemoryRouter initialEntries={['/upload']}>
          <AppShell
            isLoggedIn={true}
            email="test@example.com"
            locals={{ patreon: false, subscriber: false }}
            features={{ kiUI: false, ops: false }}
          >
            <div>page</div>
          </AppShell>
        </MemoryRouter>
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    const logoutLink = screen.getByRole('link', { name: /log out/i });
    fireEvent.click(logoutLink);
    expect(logoutSpy).toHaveBeenCalledTimes(1);
  });

  it('does not call window.confirm when the Log out link is clicked', () => {
    render(
      withClient(
        <MemoryRouter initialEntries={['/upload']}>
          <AppShell
            isLoggedIn={true}
            email="test@example.com"
            locals={{ patreon: false, subscriber: false }}
            features={{ kiUI: false, ops: false }}
          >
            <div>page</div>
          </AppShell>
        </MemoryRouter>
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    const logoutLink = screen.getByRole('link', { name: /log out/i });
    fireEvent.click(logoutLink);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

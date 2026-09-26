import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '../../lib/i18n';
import deChrome from '../../lib/i18n/locales/de/chrome.json';
import deCommon from '../../lib/i18n/locales/de/common.json';
import { Sidebar } from './Sidebar';
import { SidebarLayout } from './SidebarLayout';

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

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/upload']}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const sidebarProps = {
  email: 'reader@example.com',
  locals: { patreon: false, subscriber: false, autoSyncActive: false },
  features: { kiUI: false, ops: false },
};

describe('Sidebar in German', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('labels the sidebar landmark and the home link in German', () => {
    renderWithProviders(<Sidebar {...sidebarProps} />);

    expect(deChrome.nav.sidebarLabel).not.toBe('Main navigation');
    expect(
      screen.getByRole('complementary', { name: deChrome.nav.sidebarLabel })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: deChrome.nav.home })
    ).toBeInTheDocument();
  });

  it('labels the More tools group in German', () => {
    renderWithProviders(<Sidebar {...sidebarProps} />);

    expect(deCommon.nav.moreTools).not.toBe('More tools');
    expect(screen.getByText(deCommon.nav.moreTools)).toBeInTheDocument();
  });

  it('shows the monthly usage line in German inside the account menu', async () => {
    renderWithProviders(
      <SidebarLayout {...sidebarProps} onLogOut={vi.fn()}>
        <div>content</div>
      </SidebarLayout>
    );

    expect(deCommon.nav.accountMenu.open).not.toBe('Account menu');
    fireEvent.click(
      screen.getByRole('button', { name: deCommon.nav.accountMenu.open })
    );
    const suffix = deCommon.nav.cardsThisMonth.replace('{{limit}}', '100');
    expect(await screen.findByText(`/ ${suffix}`)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: deCommon.nav.accountMenu.upgrade })
    ).toHaveAttribute('href', '/pricing?from=avatar');
  });

  it('translates the skip link in the layout', () => {
    renderWithProviders(
      <SidebarLayout {...sidebarProps} onLogOut={vi.fn()}>
        <div>content</div>
      </SidebarLayout>
    );

    expect(deChrome.nav.skipToContent).not.toBe('Skip to content');
    expect(
      screen.getByRole('link', { name: deChrome.nav.skipToContent })
    ).toHaveAttribute('href', '#main-content');
  });
});

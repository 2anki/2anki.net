import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '../../lib/i18n';
import deChrome from '../../lib/i18n/locales/de/chrome.json';
import deCommon from '../../lib/i18n/locales/de/common.json';
import deTools from '../../lib/i18n/locales/de/tools.json';
import { getCardUsage } from '../../lib/backend/getCardUsage';
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
  onLogOut: vi.fn(),
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

  it('shows the monthly usage line in German', async () => {
    renderWithProviders(<Sidebar {...sidebarProps} />);

    const suffix = deCommon.nav.cardsThisMonth.replace('{{limit}}', '100');
    expect(await screen.findByText(`/ ${suffix}`)).toBeInTheDocument();
  });

  it('shows the upgrade link in German once the monthly limit is reached', async () => {
    vi.mocked(getCardUsage).mockResolvedValueOnce({
      cards_used: 100,
      cards_limit: 100,
      unlimited: false,
    });
    renderWithProviders(<Sidebar {...sidebarProps} />);

    expect(deTools.print.upgradeUnlimited).not.toBe('Upgrade for unlimited');
    expect(
      await screen.findByRole('link', { name: deTools.print.upgradeUnlimited })
    ).toHaveAttribute('href', '/pricing?from=limit');
  });

  it('translates the skip link in the layout', () => {
    renderWithProviders(
      <SidebarLayout {...sidebarProps}>
        <div>content</div>
      </SidebarLayout>
    );

    expect(deChrome.nav.skipToContent).not.toBe('Skip to content');
    expect(
      screen.getByRole('link', { name: deChrome.nav.skipToContent })
    ).toHaveAttribute('href', '#main-content');
  });
});

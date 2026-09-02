import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '../../lib/i18n';
import { NotionLandingPage } from './NotionLandingPage';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HelmetProvider>
        <MemoryRouter>
          <NotionLandingPage />
        </MemoryRouter>
      </HelmetProvider>
    </QueryClientProvider>
  );
}

describe('NotionLandingPage in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the hero headline in German', () => {
    renderPage();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Deine Notion-Notizen werden zu Anki-Karten',
      })
    ).toBeInTheDocument();
  });

  it('translates the connect action', () => {
    renderPage();
    expect(
      screen.getByRole('link', { name: 'Notion verbinden' })
    ).toBeInTheDocument();
  });

  it('keeps the Day Pass plan name', () => {
    renderPage();
    expect(screen.getByText('Day Pass')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Day Pass holen' })
    ).toBeInTheDocument();
  });
});

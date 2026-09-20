import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '../../lib/i18n';
import dePreviews from '../../lib/i18n/locales/de/previews.json';
import SharedDeckPage from './SharedDeckPage';
import * as sharedDeckLib from '../../lib/backend/getSharedDeck';

global.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;

vi.mock('../../lib/backend/getSharedDeck', () => ({
  getSharedDeckMeta: vi.fn(),
  getSharedDeckBatch: vi.fn(),
}));

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  HelmetProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

function renderPage(token: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/s/${token}`]}>
        <Routes>
          <Route path="/s/:token" element={<SharedDeckPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SharedDeckPage in German', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    globalThis.sessionStorage.clear();
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the revoked-link message in German', async () => {
    vi.mocked(sharedDeckLib.getSharedDeckMeta).mockRejectedValue(
      new Error('This link was turned off by the owner.')
    );
    vi.mocked(sharedDeckLib.getSharedDeckBatch).mockRejectedValue(
      new Error('This link was turned off by the owner.')
    );
    renderPage('revoked-token');

    expect(
      await screen.findByText(dePreviews.sharedDeck.linkInactive)
    ).toBeInTheDocument();
    expect(
      screen.getByText(dePreviews.sharedDeck.linkInactiveHint)
    ).toBeInTheDocument();
    expect(dePreviews.sharedDeck.linkInactive).not.toBe(
      'This link is no longer active.'
    );
  });

  it('shows the empty-deck notice in German', async () => {
    vi.mocked(sharedDeckLib.getSharedDeckMeta).mockResolvedValue({
      totalCards: 0,
      decks: [],
    });
    vi.mocked(sharedDeckLib.getSharedDeckBatch).mockResolvedValue({
      cards: [],
      nextCursor: null,
      total: 0,
    });
    renderPage('empty-token');

    expect(
      await screen.findByText(dePreviews.sharedDeck.emptyTitle)
    ).toBeInTheDocument();
    expect(
      screen.getByText(dePreviews.sharedDeck.emptyDescription)
    ).toBeInTheDocument();
  });
});

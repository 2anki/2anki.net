import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

global.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SharedDeckPage from './SharedDeckPage';
import * as sharedDeckLib from '../../lib/backend/getSharedDeck';

vi.mock('../../lib/backend/getSharedDeck', () => ({
  getSharedDeckMeta: vi.fn(),
  getSharedDeckBatch: vi.fn(),
}));

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  HelmetProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderPage(token: string) {
  const client = makeQueryClient();
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SharedDeckPage', () => {
  it('renders the revoked-link message when meta returns a 404-style error', async () => {
    vi.mocked(sharedDeckLib.getSharedDeckMeta).mockRejectedValue(
      new Error('This link was turned off by the owner.')
    );
    vi.mocked(sharedDeckLib.getSharedDeckBatch).mockRejectedValue(
      new Error('This link was turned off by the owner.')
    );

    renderPage('revoked-token');

    await screen.findByText('This link is no longer active.');
    expect(screen.getByText(/Ask them for a new one/i)).toBeInTheDocument();
  });

  it('renders card list when meta and batch resolve successfully', async () => {
    vi.mocked(sharedDeckLib.getSharedDeckMeta).mockResolvedValue({
      totalCards: 1,
      decks: [{ id: 1, fullName: 'Biology', path: ['Biology'], cardCount: 1 }],
    });
    vi.mocked(sharedDeckLib.getSharedDeckBatch).mockResolvedValue({
      cards: [
        {
          id: 100,
          ord: 0,
          templateName: 'Basic',
          deckName: 'Biology',
          deckPath: ['Biology'],
          noteTypeName: 'Basic',
          css: '',
          front: '<p>Front</p>',
          back: '<p>Back</p>',
        },
      ],
      nextCursor: null,
      total: 1,
    });

    renderPage('active-token');

    await screen.findByText('Download deck');
    expect(screen.getByText('2anki')).toBeInTheDocument();
  });

  it('renders download link pointing to /api/shares/:token/download', async () => {
    vi.mocked(sharedDeckLib.getSharedDeckMeta).mockResolvedValue({
      totalCards: 0,
      decks: [],
    });
    vi.mocked(sharedDeckLib.getSharedDeckBatch).mockResolvedValue({
      cards: [],
      nextCursor: null,
      total: 0,
    });

    renderPage('my-token');

    await screen.findByText('Download deck');
    const link = screen.getByRole('link', { name: 'Download deck' });
    expect(link).toHaveAttribute('href', '/api/shares/my-token/download');
  });
});

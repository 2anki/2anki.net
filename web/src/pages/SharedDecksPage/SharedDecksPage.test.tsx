import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SharedDecksPage from './SharedDecksPage';
import * as sharedDeckLib from '../../lib/backend/getSharedDeck';

vi.mock('../../lib/backend/getSharedDeck', () => ({
  getPublicSharedDecks: vi.fn(),
}));

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <SharedDecksPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SharedDecksPage', () => {
  it('renders the empty state when there are no public decks', async () => {
    vi.mocked(sharedDeckLib.getPublicSharedDecks).mockResolvedValue({
      decks: [],
      nextCursor: null,
    });

    renderPage();

    expect(await screen.findByText('No public decks yet')).toBeVisible();
  });

  it('renders each deck with title, card count, and a view link', async () => {
    vi.mocked(sharedDeckLib.getPublicSharedDecks).mockResolvedValue({
      decks: [
        {
          token: 't1',
          title: 'Organic chemistry',
          card_count: 42,
          created_at: '2026-07-01T00:00:00Z',
          view_count: 3,
          url: 'https://2anki.net/s/t1',
        },
      ],
      nextCursor: null,
    });

    renderPage();

    await screen.findByText('Organic chemistry');
    expect(screen.getByText('42 cards')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'View deck' });
    expect(link).toHaveAttribute('href', '/s/t1');
  });

  it('loads another page when Load more is clicked', async () => {
    vi.mocked(sharedDeckLib.getPublicSharedDecks)
      .mockResolvedValueOnce({
        decks: [
          {
            token: 't1',
            title: 'Deck one',
            card_count: 5,
            created_at: '2026-07-01T00:00:00Z',
            view_count: 0,
            url: 'https://2anki.net/s/t1',
          },
        ],
        nextCursor: 24,
      })
      .mockResolvedValueOnce({
        decks: [
          {
            token: 't2',
            title: 'Deck two',
            card_count: 8,
            created_at: '2026-07-02T00:00:00Z',
            view_count: 0,
            url: 'https://2anki.net/s/t2',
          },
        ],
        nextCursor: null,
      });

    renderPage();

    await screen.findByText('Deck one');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => screen.getByText('Deck two'));
    expect(sharedDeckLib.getPublicSharedDecks).toHaveBeenCalledWith(24);
  });

  it('shows an error message when loading fails', async () => {
    vi.mocked(sharedDeckLib.getPublicSharedDecks).mockRejectedValue(
      new Error('network error')
    );

    renderPage();

    expect(
      await screen.findByText("Couldn't load the shared library. Try again.")
    ).toBeVisible();
  });
});

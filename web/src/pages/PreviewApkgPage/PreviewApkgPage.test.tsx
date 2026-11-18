import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { shouldRetryQuery } from '../../lib/shouldRetryQuery';
import PreviewApkgPage from './PreviewApkgPage';

class NoopIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function renderPage(setError = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/preview/apkg/deck.apkg']}>
        <Routes>
          <Route
            path="/preview/apkg/:key"
            element={<PreviewApkgPage setError={setError} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { setError };
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>, route: string): number {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(route))
    .length;
}

describe('PreviewApkgPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks once for a deck too large to preview and says so once', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/cards')) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return new Response(
        JSON.stringify({
          message: 'This Anki package is too large to process.',
        }),
        { status: 413, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const { setError } = renderPage();

    expect(
      await screen.findByText('This deck is too large to preview.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Download it and open it in Anki to see its cards.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' })
    ).not.toBeInTheDocument();
    expect(callsTo(fetchMock, '/cards')).toBe(1);
    await waitFor(() => expect(callsTo(fetchMock, '/meta')).toBe(1));
    expect(setError).not.toHaveBeenCalled();
  });

  it('still reports a deck list failure once the cards have loaded', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/cards')
        ? new Response(
            JSON.stringify({ cards: [], nextCursor: null, total: 0 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        : new Response(JSON.stringify({ message: 'boom' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
    );
    const { setError } = renderPage();

    await waitFor(() => expect(setError).toHaveBeenCalledTimes(1));
    expect(callsTo(fetchMock, '/meta')).toBe(4);
  });

  it('keeps an edit on the card it was made on across a deck filter change', async () => {
    const card = (id: number, deck: string, back: string) => ({
      id,
      ord: 0,
      templateName: 'Card 1',
      deckName: deck,
      deckPath: [deck],
      noteTypeName: 'Basic',
      css: '',
      front: `<div>${deck} front</div>`,
      back: `<div>${deck} front</div><hr>${back}`,
      editable: {
        front: { fieldIndex: 0, fieldName: 'Front', value: `${deck} front` },
        back: { fieldIndex: 1, fieldName: 'Back', value: back },
      },
    });
    const biology = card(100, 'Biology', 'cell');
    const chemistry = card(200, 'Chemistry', 'atom');
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/download-edited')) {
        return new Response(new Blob(['apkg']), { status: 200 });
      }
      if (url.includes('/meta')) {
        return json({
          totalCards: 2,
          decks: [
            { id: 2, fullName: 'Biology', path: ['Biology'], cardCount: 1 },
            { id: 3, fullName: 'Chemistry', path: ['Chemistry'], cardCount: 1 },
          ],
        });
      }
      const cards = url.includes('deck_id=3')
        ? [chemistry]
        : [biology, chemistry];
      return json({ cards, nextCursor: null, total: cards.length });
    });
    class BlobUrl extends URL {
      static createObjectURL = vi.fn(() => 'blob:apkg');
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', BlobUrl);
    renderPage();

    const deckSelect = await screen.findByRole('combobox');
    fireEvent.change(deckSelect, { target: { value: '3' } });
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /edit back/i })
      ).toHaveLength(1)
    );
    fireEvent.click(screen.getByRole('button', { name: /edit back/i }));
    const textarea = screen.getByRole('textbox', { name: 'Back' });
    expect(textarea).toHaveValue('atom');
    fireEvent.change(textarea, { target: { value: 'atom, edited' } });
    fireEvent.blur(textarea);
    fireEvent.change(deckSelect, { target: { value: '' } });
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /edit back/i })
      ).toHaveLength(2)
    );

    expect(screen.getAllByText('Edited')).toHaveLength(1);
    expect(screen.getByText('Edited').closest('section')).toHaveTextContent(
      'Chemistry'
    );

    fireEvent.click(screen.getByRole('button', { name: /download deck/i }));
    await waitFor(() => expect(callsTo(fetchMock, '/download-edited')).toBe(1));
    const [, init] = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/download-edited')
    ) as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      edits: [{ cardId: 200, fields: [{ index: 1, value: 'atom, edited' }] }],
    });
  });

  it('keeps retrying a network failure and offers to try again', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();

    expect(
      await screen.findByRole('button', { name: 'Try again' })
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, '/cards')).toBe(4);
  });
});

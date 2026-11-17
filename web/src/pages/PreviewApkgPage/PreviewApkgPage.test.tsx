import { render, screen, waitFor } from '@testing-library/react';
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

  it('keeps retrying a network failure and offers to try again', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();

    expect(
      await screen.findByRole('button', { name: 'Try again' })
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, '/cards')).toBe(4);
  });
});

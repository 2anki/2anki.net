import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import PreviewPage from './PreviewPage';
import { UserNotice } from '../../lib/errors/UserNotice';

const mockUsePreviewStream = vi.fn();
const mockConvert = vi.fn();
const mockNavigate = vi.fn();

vi.mock('./usePreviewStream', () => ({
  usePreviewStream: (...args: unknown[]) => mockUsePreviewStream(...args),
}));

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ convert: mockConvert }),
}));

vi.mock('react-router-dom', async () => {
  const real =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return { ...real, useNavigate: () => mockNavigate };
});

global.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;

function makeBlock(id: string, decision: 'card' | 'skip' | 'recurse' = 'card') {
  return {
    id,
    type: 'paragraph',
    hasChildren: false,
    canExpand: false,
    html: `<p>${id}</p>`,
    decision,
  };
}

function makeStreamReturn(
  blocks: {
    id: string;
    type: string;
    hasChildren: boolean;
    canExpand: boolean;
    html: string;
    decision?: string;
  }[],
  hasNextPage = false
) {
  return {
    data: {
      pages: [
        {
          blocks,
          nextCursor: null,
          hasMore: false,
          pageTitle: 'Test Page',
          pageUrl: null,
        },
      ],
    },
    isLoading: false,
    error: null,
    hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  };
}

function renderPreview(id = 'page-abc') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/preview/${id}`]}>
        <Routes>
          <Route
            path="/preview/:id"
            element={<PreviewPage setError={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockConvert.mockReset();
});

describe('PreviewPage deleted-page handling', () => {
  it('shows not-available state when the error contains 404', () => {
    mockUsePreviewStream.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error(
        'Resource not found: GET /api/notion/page/abc status: 404 Not Found'
      ),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });

    renderPreview();

    expect(
      screen.getByText('This page is no longer available')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'It was deleted in Notion, or the integration lost access.'
      )
    ).toBeInTheDocument();

    const notionLink = screen.getByRole('link', { name: 'Notion search' });
    expect(notionLink).toHaveAttribute('href', '/notion');

    const decksLink = screen.getByRole('link', { name: 'My decks' });
    expect(decksLink).toHaveAttribute('href', '/downloads');
  });

  it('shows ErrorPresenter for non-404 errors', () => {
    mockUsePreviewStream.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('HTTP error! status: 500, message: Internal'),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });

    renderPreview();

    expect(
      screen.queryByText('This page is no longer available')
    ).not.toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });
});

describe('PreviewPage tally counts', () => {
  it('shows card, skip, and sub-page counts from blocks', () => {
    mockUsePreviewStream.mockReturnValue(
      makeStreamReturn([
        makeBlock('b1', 'card'),
        makeBlock('b2', 'card'),
        makeBlock('b3', 'skip'),
        makeBlock('b4', 'recurse'),
      ])
    );

    renderPreview();

    expect(screen.getByText('2 cards')).toBeInTheDocument();
    expect(screen.getByText('1 skipped')).toBeInTheDocument();
    expect(screen.getByText('1 sub-page')).toBeInTheDocument();
  });

  it('does not show tally when all decision fields are absent', () => {
    mockUsePreviewStream.mockReturnValue(
      makeStreamReturn([
        {
          id: 'b1',
          type: 'paragraph',
          hasChildren: false,
          canExpand: false,
          html: '<p>hi</p>',
        },
      ])
    );

    renderPreview();

    expect(screen.queryByText(/\d+ cards/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ skipped/)).not.toBeInTheDocument();
  });

  it('shows plural sub-pages when count > 1', () => {
    mockUsePreviewStream.mockReturnValue(
      makeStreamReturn([makeBlock('b1', 'recurse'), makeBlock('b2', 'recurse')])
    );

    renderPreview();

    expect(screen.getByText('2 sub-pages')).toBeInTheDocument();
  });

  it('appends loading indicator when hasNextPage is true', () => {
    mockUsePreviewStream.mockReturnValue(
      makeStreamReturn([makeBlock('b1', 'card')], true)
    );

    renderPreview();

    expect(screen.getByText(/\+ loading more/i)).toBeInTheDocument();
  });
});

describe('PreviewPage empty state', () => {
  it('teaches the toggle pattern and links to the toggles doc when there are no blocks', () => {
    mockUsePreviewStream.mockReturnValue(makeStreamReturn([]));

    renderPreview();

    expect(
      screen.getByText('Nothing to turn into cards yet')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/makes a card from every toggle on this page/i)
    ).toBeInTheDocument();
    const cta = screen.getByRole('link', {
      name: 'See how toggles become cards',
    });
    expect(cta).toHaveAttribute('href', '/documentation/cards/notion-blocks');
  });
});

describe('PreviewPage Convert to Anki CTA', () => {
  it('renders the Convert to Anki button', () => {
    mockUsePreviewStream.mockReturnValue(makeStreamReturn([]));

    renderPreview();

    expect(
      screen.getByRole('button', { name: 'Convert to Anki' })
    ).toBeInTheDocument();
  });

  it('disables the button and shows Converting label while in-flight', async () => {
    mockConvert.mockReturnValue(new Promise(() => {}));
    mockUsePreviewStream.mockReturnValue(makeStreamReturn([]));

    renderPreview();

    const btn = screen.getByRole('button', { name: 'Convert to Anki' });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Converting…' })
      ).toBeDisabled();
    });
  });

  it('navigates to /downloads on 202 response', async () => {
    mockConvert.mockResolvedValue({ status: 202, json: async () => ({}) });
    mockUsePreviewStream.mockReturnValue(makeStreamReturn([]));

    renderPreview();

    fireEvent.click(screen.getByRole('button', { name: 'Convert to Anki' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/downloads');
    });
  });

  it('re-enables button on error response', async () => {
    mockConvert.mockResolvedValue({
      status: 500,
      text: async () => 'Server error',
    });
    mockUsePreviewStream.mockReturnValue(makeStreamReturn([]));

    renderPreview();

    fireEvent.click(screen.getByRole('button', { name: 'Convert to Anki' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Convert to Anki' })
      ).not.toBeDisabled();
    });
  });

  function renderPreviewWithError(setError: (error: unknown) => void) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/preview/page-abc']}>
          <Routes>
            <Route
              path="/preview/:id"
              element={<PreviewPage setError={setError} />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('shows a dead Notion connection once, on the page, not also in the global banner', async () => {
    const setError = vi.fn();
    mockUsePreviewStream.mockReturnValue({
      ...makeStreamReturn([]),
      data: undefined,
      isLoading: false,
      error: new UserNotice(
        'Your Notion connection expired. Reconnect Notion and try again.',
        'notion_unauthorized'
      ),
    });

    renderPreviewWithError(setError);

    expect(await screen.findAllByText(/Reconnect Notion/)).not.toHaveLength(0);
    expect(setError).not.toHaveBeenCalled();
  });

  it('shows friendly copy and not raw JSON on a 409 already_in_progress', async () => {
    const setError = vi.fn();
    mockConvert.mockResolvedValue({
      status: 409,
      text: async () => '{"reason":"already_in_progress"}',
    });
    mockUsePreviewStream.mockReturnValue(makeStreamReturn([]));

    renderPreviewWithError(setError);

    fireEvent.click(screen.getByRole('button', { name: 'Convert to Anki' }));

    await waitFor(() => {
      expect(setError).toHaveBeenCalled();
    });

    const passedError = setError.mock.calls[0][0] as Error;
    expect(passedError.message).toBe(
      'This page is already converting — check My decks in a moment.'
    );
    expect(passedError.message).not.toContain('already_in_progress');
    expect(passedError.message).not.toContain('{');
    expect(passedError).toBeInstanceOf(UserNotice);
  });

  it('shows a readable message on other 4xx errors without reporting them', async () => {
    const setError = vi.fn();
    mockConvert.mockResolvedValue({
      status: 400,
      text: async () => '{"error":"bad request"}',
    });
    mockUsePreviewStream.mockReturnValue(makeStreamReturn([]));

    renderPreviewWithError(setError);

    fireEvent.click(screen.getByRole('button', { name: 'Convert to Anki' }));

    await waitFor(() => {
      expect(setError).toHaveBeenCalled();
    });

    const passedError = setError.mock.calls[0][0] as Error;
    expect(passedError.message).toBe(
      'Could not start the conversion. Try again in a moment.'
    );
    expect(passedError.message).not.toContain('{');
    expect(passedError).toBeInstanceOf(UserNotice);
  });

  it('reports a genuine 5xx failure as a plain Error', async () => {
    const setError = vi.fn();
    mockConvert.mockResolvedValue({
      status: 500,
      text: async () => '{"error":"boom"}',
    });
    mockUsePreviewStream.mockReturnValue(makeStreamReturn([]));

    renderPreviewWithError(setError);

    fireEvent.click(screen.getByRole('button', { name: 'Convert to Anki' }));

    await waitFor(() => {
      expect(setError).toHaveBeenCalled();
    });

    const passedError = setError.mock.calls[0][0] as Error;
    expect(passedError.message).not.toContain('{');
    expect(passedError.message).toBe(
      'Could not start the conversion. Try again in a moment.'
    );
    expect(passedError).not.toBeInstanceOf(UserNotice);
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import PrintForm from './PrintForm';

const { localsHolder, trackMock } = vi.hoisted(() => ({
  localsHolder: {
    value: {
      data: {
        locals: { patreon: false, subscriber: false },
        freePrintAvailable: true as boolean | null,
      },
    } as unknown,
  },
  trackMock: vi.fn(),
}));

vi.mock('../../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => localsHolder.value,
}));

vi.mock('../../../lib/analytics/track', () => ({
  track: trackMock,
}));

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone() {
      return { json: async () => body };
    },
  } as unknown as Response;
}

const renderForm = () =>
  render(
    <MemoryRouter>
      <PrintForm />
    </MemoryRouter>
  );

const pickApkg = (name = 'deck.apkg') => {
  const file = new File(['fake'], name, { type: 'application/octet-stream' });
  const input = screen.getByLabelText(/Drop an Anki deck/i, {
    selector: 'input[type="file"]',
  }) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};

function routeFetch(responses: {
  preview?: Response;
  download?: Response;
}): void {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
    (url: string) => {
      if (String(url).includes('/api/apkg/pdf/preview')) {
        return Promise.resolve(responses.preview ?? jsonResponse(500, {}));
      }
      return Promise.resolve(responses.download ?? jsonResponse(500, {}));
    }
  );
}

describe('PrintForm', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    trackMock.mockClear();
    localsHolder.value = {
      data: {
        locals: { patreon: false, subscriber: false },
        freePrintAvailable: true,
      },
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('previews the first cards and offers the free PDF download for a free user', async () => {
    routeFetch({
      preview: jsonResponse(200, {
        image: 'data:image/png;base64,AAA',
        totalCards: 42,
        previewedCards: 3,
      }),
    });

    renderForm();
    pickApkg();

    await waitFor(() => {
      expect(screen.getByText(/first 3 of 42 cards/i)).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /Download the full PDF/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Uses your 1 free PDF this month/i)
    ).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/apkg/pdf/preview',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('fires print_preview_shown once with the deck counts', async () => {
    routeFetch({
      preview: jsonResponse(200, {
        image: 'data:image/png;base64,AAA',
        totalCards: 42,
        previewedCards: 3,
      }),
    });

    renderForm();
    pickApkg();

    await waitFor(() => {
      expect(trackMock).toHaveBeenCalledWith('print_preview_shown', {
        totalCards: 42,
        previewedCards: 3,
        freePrintAvailable: true,
      });
    });
    expect(trackMock).toHaveBeenCalledTimes(1);
  });

  test('offers a day pass instead of the free PDF once the print is used', async () => {
    localsHolder.value = {
      data: {
        locals: { patreon: false, subscriber: false },
        freePrintAvailable: false,
      },
    };
    routeFetch({
      preview: jsonResponse(200, {
        image: 'data:image/png;base64,AAA',
        totalCards: 10,
        previewedCards: 3,
      }),
    });

    renderForm();
    pickApkg();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Get a day pass/i })
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('link', { name: /See all plans/i })
    ).toHaveAttribute('href', '/pricing');
    expect(
      screen.queryByRole('button', { name: /Download the full PDF/i })
    ).not.toBeInTheDocument();
  });

  test('shows a friendly corrupted message with no payment ask when preview reports Invalid .apkg', async () => {
    routeFetch({
      preview: jsonResponse(400, { message: 'Invalid .apkg file' }),
    });

    renderForm();
    pickApkg();

    await waitFor(() => {
      expect(screen.getByText(/Couldn't read this file/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /Download the full PDF/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Get a day pass/i })
    ).not.toBeInTheDocument();
  });

  test('shows the empty-deck message with no payment ask for a 0-card deck', async () => {
    routeFetch({
      preview: jsonResponse(200, {
        image: null,
        totalCards: 0,
        previewedCards: 0,
      }),
    });

    renderForm();
    pickApkg();

    await waitFor(() => {
      expect(screen.getByText(/no cards to print/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /Download the full PDF/i })
    ).not.toBeInTheDocument();
  });

  test('keeps the card-limit message with an Upgrade link on the download step', async () => {
    routeFetch({
      preview: jsonResponse(200, {
        image: 'data:image/png;base64,AAA',
        totalCards: 1873,
        previewedCards: 3,
      }),
      download: jsonResponse(400, {
        message:
          'This deck has 1873 cards. PDF export supports up to 1000 cards.',
      }),
    });

    renderForm();
    pickApkg();

    const download = await screen.findByRole('button', {
      name: /Download the full PDF/i,
    });
    fireEvent.click(download);

    await waitFor(() => {
      expect(
        screen.getByText(/PDF export supports up to 1000 cards/)
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('link', { name: /Upgrade for unlimited/i })
    ).toHaveAttribute('href', '/pricing');
  });

  test('previews a dropped deck through the preview endpoint', async () => {
    routeFetch({
      preview: jsonResponse(200, {
        image: 'data:image/png;base64,AAA',
        totalCards: 5,
        previewedCards: 3,
      }),
    });

    renderForm();
    const zone = screen.getByText(/Drop an Anki deck/i).closest('label');
    expect(zone).not.toBeNull();
    const file = new File(['fake'], 'deck.apkg', {
      type: 'application/octet-stream',
    });

    fireEvent.drop(zone!, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/apkg/pdf/preview',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  test('rejects a non-.apkg pick without calling the preview endpoint', async () => {
    renderForm();
    pickApkg('notes.pdf');

    await waitFor(() => {
      expect(
        screen.getByText(/works with Anki deck files/i)
      ).toBeInTheDocument();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('PrintForm with decks that arrive in a zip', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    localsHolder.value = {
      data: {
        locals: { patreon: false, subscriber: false },
        freePrintAvailable: true,
      },
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('asks which deck to print and previews the one picked', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(409, {
          code: 'choose_deck',
          decks: ['a/Biology.apkg', 'b/Chemistry.apkg'],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          image: 'data:image/png;base64,AAA',
          totalCards: 3,
          previewedCards: 3,
        })
      );
    renderForm();

    pickApkg('decks.zip');
    fireEvent.click(await screen.findByLabelText('Chemistry'));
    fireEvent.click(screen.getByRole('button', { name: 'Print this deck' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = fetchMock.mock.calls[1][1].body as FormData;
    expect(body.get('deck_entry')).toBe('b/Chemistry.apkg');
  });

  test('takes a zip of notes to the upload page with the same file', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(422, { code: 'not_a_deck' })
    );
    let handedOff: unknown = null;
    function UploadProbe() {
      handedOff = (useLocation().state as { handoffFile?: File } | null)
        ?.handoffFile;
      return <p>upload page</p>;
    }
    render(
      <MemoryRouter initialEntries={['/print']}>
        <Routes>
          <Route path="/print" element={<PrintForm />} />
          <Route path="/upload" element={<UploadProbe />} />
        </Routes>
      </MemoryRouter>
    );

    pickApkg('notes.zip');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Make a deck from it' })
    );

    expect(await screen.findByText('upload page')).toBeInTheDocument();
    expect((handedOff as File).name).toBe('notes.zip');
  });

  test('starts the preview for a deck handed over from the upload page', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        image: 'data:image/png;base64,AAA',
        totalCards: 1,
        previewedCards: 1,
      })
    );
    const file = new File(['deck'], 'Biology.zip');
    let latestState: unknown = 'unset';
    function StateProbe() {
      latestState = useLocation().state;
      return null;
    }
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/print', state: { handoffFile: file } }]}
      >
        <PrintForm />
        <StateProbe />
      </MemoryRouter>
    );

    await waitFor(() => expect(latestState).toBeNull());
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/apkg/pdf/preview',
        expect.objectContaining({ method: 'POST' })
      )
    );
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect((body.get('file') as File).name).toBe('Biology.zip');
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import PrintForm from './PrintForm';

const { localsHolder, trackMock } = vi.hoisted(() => ({
  localsHolder: {
    value: {
      data: {
        user: { id: 7 },
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
        user: { id: 7 },
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

  test('says to confirm the email when the pass is refused over an unproven plan', async () => {
    localsHolder.value = {
      data: {
        user: { id: 7 },
        locals: { patreon: false, subscriber: false },
        freePrintAvailable: false,
      },
    };
    routeFetch({
      preview: jsonResponse(200, {
        image: 'data:image/png;base64,AAA',
        totalCards: 42,
        previewedCards: 3,
      }),
      download: jsonResponse(409, {
        code: 'confirm_address',
        message: 'server copy',
        expiresAt: null,
      }),
    });

    renderForm();
    pickApkg();

    fireEvent.click(
      await screen.findByRole('button', { name: /Get a day pass/i })
    );

    expect(
      await screen.findByText(
        'A plan is already billed to this email. Confirm this email with a sign-in link, then try again.'
      )
    ).toBeInTheDocument();
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
        user: { id: 7 },
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
        user: { id: 7 },
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

function htmlResponse(status: number): Response {
  const notJson = async () => {
    throw new SyntaxError('Unexpected token <');
  };
  return {
    ok: false,
    status,
    json: notJson,
    clone() {
      return { json: notJson };
    },
  } as unknown as Response;
}

const SIGNED_OUT = {
  data: {
    user: { id: undefined },
    locals: {},
    freePrintAvailable: null,
  },
  isLoading: false,
  isError: false,
};

const SIGNED_IN = {
  data: {
    user: { id: 7 },
    locals: { patreon: false, subscriber: false },
    freePrintAvailable: true,
  },
  isLoading: false,
  isError: false,
};

const LOADING = { data: undefined, isLoading: true, isError: false };

const PREVIEW_OK = {
  image: 'data:image/png;base64,AAA',
  totalCards: 42,
  previewedCards: 3,
};

const SIGN_IN_HEADING = 'Sign in to preview and print this deck';

function previewCalls(): unknown[] {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([url]) => String(url).includes('/api/apkg/pdf/preview')
  );
}

function renderRerenderableForm() {
  const view = renderForm();
  return () =>
    view.rerender(
      <MemoryRouter>
        <PrintForm />
      </MemoryRouter>
    );
}

describe('PrintForm before sending a deck', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    routeFetch({ preview: jsonResponse(200, PREVIEW_OK) });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('asks a signed-out visitor to sign in and sends nothing', async () => {
    localsHolder.value = SIGNED_OUT;
    renderForm();

    pickApkg('Biology.apkg');

    expect(
      await screen.findByRole('heading', { name: SIGN_IN_HEADING })
    ).toBeInTheDocument();
    expect(screen.getByText('Biology.apkg')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Create a free account' })
    ).toHaveAttribute('href', '/register?redirect=/print');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      '/login?redirect=/print'
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('takes a signed-out visitor back to the drop zone on Cancel', async () => {
    localsHolder.value = SIGNED_OUT;
    renderForm();

    pickApkg();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(
      screen.getByLabelText(/Drop an Anki deck/i, {
        selector: 'input[type="file"]',
      })
    ).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('waits for the session before sending the deck of a signed-in user', async () => {
    localsHolder.value = LOADING;
    const rerender = renderRerenderableForm();

    pickApkg();
    expect(await screen.findByText('Making your preview')).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    localsHolder.value = SIGNED_IN;
    rerender();

    await waitFor(() => expect(previewCalls()).toHaveLength(1));
  });

  test('shows the sign-in prompt once a loading session turns out signed out', async () => {
    localsHolder.value = LOADING;
    const rerender = renderRerenderableForm();

    pickApkg();
    localsHolder.value = SIGNED_OUT;
    rerender();

    expect(
      await screen.findByRole('heading', { name: SIGN_IN_HEADING })
    ).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('sends the deck and lets the server decide when the session could not be read', async () => {
    localsHolder.value = { data: undefined, isLoading: false, isError: true };
    renderForm();

    pickApkg();

    await waitFor(() => expect(previewCalls()).toHaveLength(1));
  });

  test('previews the chosen deck once the visitor signs in with the prompt open', async () => {
    localsHolder.value = SIGNED_OUT;
    const rerender = renderRerenderableForm();

    pickApkg('Biology.apkg');
    await screen.findByRole('heading', { name: SIGN_IN_HEADING });
    localsHolder.value = SIGNED_IN;
    rerender();

    expect(await screen.findByText(/first 3 of 42 cards/i)).toBeInTheDocument();
    expect(previewCalls()).toHaveLength(1);
  });

  test('sends the deck at once for a signed-in user', async () => {
    localsHolder.value = SIGNED_IN;
    renderForm();

    pickApkg();

    await waitFor(() => expect(previewCalls()).toHaveLength(1));
  });
});

describe('PrintForm preview failures', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    localsHolder.value = SIGNED_IN;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('asks to sign in again when the session ends before the preview', async () => {
    routeFetch({
      preview: jsonResponse(401, { message: 'Authentication required' }),
    });
    renderForm();

    pickApkg();

    expect(
      await screen.findByRole('heading', { name: SIGN_IN_HEADING })
    ).toBeInTheDocument();
  });

  test.each([
    [
      'a deck over the size limit',
      jsonResponse(413, {
        message: 'This Anki package is too large to process.',
      }),
      'This deck is too large to print. Split it into smaller decks in Anki and try again.',
    ],
    [
      'too many previews from this user',
      jsonResponse(429, {
        message: 'Too many preview requests. Try again in a minute.',
      }),
      'Too many previews at once. Try again in a moment.',
    ],
    [
      'too many previews on the server',
      jsonResponse(503, {
        message:
          'Too many previews are rendering right now. Try again in a moment.',
      }),
      'Too many previews at once. Try again in a moment.',
    ],
    [
      'an invalid deck',
      jsonResponse(400, { message: 'Invalid .apkg file' }),
      "Couldn't read this file. Make sure it's a valid Anki deck (.apkg) and try again.",
    ],
    [
      'a render that took too long',
      jsonResponse(400, {
        message: 'This deck took too long to render. Try a smaller deck.',
      }),
      'This deck took too long to render. Try a smaller deck.',
    ],
    [
      'a proxy that cut the upload off',
      htmlResponse(400),
      "Couldn't reach 2anki. Check your connection and try again.",
    ],
    [
      'an upload that timed out',
      htmlResponse(408),
      "Couldn't reach 2anki. Check your connection and try again.",
    ],
    [
      'a proxy error',
      htmlResponse(502),
      'Something broke on our end while making the preview. Try again in a moment.',
    ],
    [
      'a server error',
      jsonResponse(500, { message: 'Preview failed.' }),
      'Something broke on our end while making the preview. Try again in a moment.',
    ],
  ])('says what happened for %s', async (_case, response, message) => {
    routeFetch({ preview: response });
    renderForm();

    pickApkg();

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  test('says the connection failed when the request never reached the server', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError('Failed to fetch')
    );
    renderForm();

    pickApkg();

    expect(
      await screen.findByText(
        "Couldn't reach 2anki. Check your connection and try again."
      )
    ).toBeInTheDocument();
  });

  test.each([
    ['a dropped connection', null],
    ['too many previews', 503],
    ['a proxy error', 502],
  ])('retries the same deck after %s', async (_case, status) => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    if (status == null) {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    } else {
      fetchMock.mockResolvedValueOnce(htmlResponse(status));
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, PREVIEW_OK));
    renderForm();

    pickApkg('Biology.apkg');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(/first 3 of 42 cards/i)).toBeInTheDocument();
    const retried = fetchMock.mock.calls[1][1].body as FormData;
    expect((retried.get('file') as File).name).toBe('Biology.apkg');
  });

  test('offers no retry for an invalid deck', async () => {
    routeFetch({
      preview: jsonResponse(400, { message: 'Invalid .apkg file' }),
    });
    renderForm();

    pickApkg();

    await screen.findByText(/Couldn't read this file/i);
    expect(
      screen.queryByRole('button', { name: 'Try again' })
    ).not.toBeInTheDocument();
  });
});

describe('PrintForm download failures', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    localsHolder.value = SIGNED_IN;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('asks to sign in again when the session ends before the download', async () => {
    routeFetch({
      preview: jsonResponse(200, PREVIEW_OK),
      download: jsonResponse(401, { message: 'Authentication required' }),
    });
    renderForm();

    pickApkg();
    fireEvent.click(
      await screen.findByRole('button', { name: /Download the full PDF/i })
    );

    expect(
      await screen.findByRole('heading', { name: SIGN_IN_HEADING })
    ).toBeInTheDocument();
  });

  test('says the free PDF is used and offers the pass when the quota is reached', async () => {
    routeFetch({
      preview: jsonResponse(200, PREVIEW_OK),
      download: jsonResponse(402, {
        message: 'Your free PDF for this month has been used.',
      }),
    });
    renderForm();

    pickApkg();
    fireEvent.click(
      await screen.findByRole('button', { name: /Download the full PDF/i })
    );

    expect(
      await screen.findByText('Your free PDF for this month has been used.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Get a day pass/i })
    ).toBeInTheDocument();
  });
});

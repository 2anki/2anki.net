import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PhotoToFlashcardsPage } from './PhotoToFlashcardsPage';
import { prepareImageForVision } from '../../lib/image/prepareImageForVision';

function renderPage() {
  return render(
    <MemoryRouter>
      <PhotoToFlashcardsPage />
    </MemoryRouter>
  );
}

const mockTrack = vi.fn();
vi.mock('../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock('../../lib/image/prepareImageForVision', () => ({
  prepareImageForVision: vi.fn(async () => ({
    base64: 'YWJjMTIz',
    mediaType: 'image/jpeg',
    width: 800,
    height: 600,
  })),
}));

const FAKE_DATA_URL = 'data:image/jpeg;base64,YWJjMTIz';

const mockUseUserLocals = vi.fn();
vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => mockUseUserLocals(),
}));

function setLocals(opts: { paying: boolean }) {
  mockUseUserLocals.mockReturnValue({
    data: {
      locals: {
        email: 'test@example.com',
        patreon: opts.paying,
        subscriptions: [],
      },
    },
  });
}

function makePhoto(
  name = 'note.jpg',
  type = 'image/jpeg',
  sizeBytes = 1024
): File {
  const blob = new Blob(['x'.repeat(sizeBytes)], { type });
  return new File([blob], name, { type });
}

function mockFileReader() {
  class FakeFileReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL() {
      this.result = FAKE_DATA_URL;
      setTimeout(() => this.onload?.(), 0);
    }
  }
  vi.stubGlobal('FileReader', FakeFileReader);
}

function mockImageDimensions(width = 800, height = 600) {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = width;
    naturalHeight = height;
    set src(_v: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  }
  vi.stubGlobal('Image', FakeImage);
}

function mockObjectUrl() {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:fake'),
    revokeObjectURL: vi.fn(),
  });
}

describe('PhotoToFlashcardsPage', () => {
  beforeEach(() => {
    setLocals({ paying: false });
    mockFileReader();
    mockImageDimensions();
    mockObjectUrl();
    mockTrack.mockClear();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('renders the title and audience hint', () => {
    renderPage();
    expect(screen.getByText('Photo to deck')).toBeTruthy();
    expect(
      screen.getByText(/Turn a photo of your notes, slides, or textbook/)
    ).toBeTruthy();
    expect(screen.getByText(/Free plan: 5 photos per month/)).toBeTruthy();
  });

  it('omits the free-plan notice for paying users', () => {
    setLocals({ paying: true });
    renderPage();
    expect(screen.queryByText(/Free plan: 5 photos per month/)).toBeNull();
  });

  it('links the multiple-choice upgrade hint to pricing for free users', () => {
    setLocals({ paying: false });
    renderPage();
    const upgrade = screen.getByRole('link', { name: 'Upgrade' });
    expect(upgrade.getAttribute('href')).toBe('/pricing?from=photo-mcq');
    expect(screen.getByText(/for multiple-choice cards/)).toBeTruthy();
  });

  it('describes multiple-choice cards without an upgrade link for paying users', () => {
    setLocals({ paying: true });
    renderPage();
    expect(screen.queryByRole('link', { name: 'Upgrade' })).toBeNull();
    expect(screen.getByText(/the AI writes options A–D/)).toBeTruthy();
  });

  it('rejects unsupported file types', () => {
    setLocals({ paying: true });
    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(
      screen.getByText('Use a photo format like JPEG, PNG, WebP, GIF, or HEIC.')
    ).toBeTruthy();
  });

  it('rejects photos over 10 MB', () => {
    setLocals({ paying: true });
    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    const oversized = makePhoto('big.jpg', 'image/jpeg', 11 * 1024 * 1024);
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(
      screen.getByText('Photo is over the 10 MB limit. Try a smaller image.')
    ).toBeTruthy();
  });

  it.each([
    ['iphone.heic', 'image/heic'],
    ['samsung.heif', 'image/heif'],
  ])('accepts %s (%s)', (name, type) => {
    setLocals({ paying: true });
    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makePhoto(name, type)] } });
    expect(screen.getByRole('button', { name: `Remove ${name}` })).toBeTruthy();
    expect(document.querySelector('[class*="notificationDanger"]')).toBeNull();
  });

  it('accepts a photo with an empty MIME type', () => {
    setLocals({ paying: true });
    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makePhoto('android-pick.jpg', '')] },
    });
    expect(
      screen.getByRole('button', { name: 'Remove android-pick.jpg' })
    ).toBeTruthy();
    expect(document.querySelector('[class*="notificationDanger"]')).toBeNull();
  });

  it('rejects an oversized photo even when the MIME type is empty', () => {
    setLocals({ paying: true });
    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makePhoto('huge.heic', '', 11 * 1024 * 1024)] },
    });
    expect(
      screen.getByText('Photo is over the 10 MB limit. Try a smaller image.')
    ).toBeTruthy();
  });

  it('shows the decode error per photo when the image cannot be read', async () => {
    setLocals({ paying: true });
    vi.mocked(prepareImageForVision).mockRejectedValueOnce(
      new Error('Could not read the image')
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makePhoto('broken.heic', 'image/heic')] },
    });
    fireEvent.click(screen.getByText('Get cards'));

    await waitFor(() => {
      expect(screen.getByText('Could not read the image')).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists HEIC and HEIF in the file picker accept attribute', () => {
    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    const camera = document.getElementById(
      'photo-camera-input'
    ) as HTMLInputElement;
    for (const accept of [input.accept, camera.accept]) {
      expect(accept).toContain('image/heic');
      expect(accept).toContain('image/heif');
      expect(accept).toContain('.heic');
      expect(accept).toContain('.heif');
    }
  });

  it('shows the specific 404 message when the route is disabled', async () => {
    setLocals({ paying: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makePhoto()] } });
    fireEvent.click(screen.getByText('Get cards'));

    await waitFor(() => {
      expect(
        screen.getByText(/Photo to deck isn't available yet/)
      ).toBeTruthy();
    });
  });

  it('shows the sign-in message on 401/403', async () => {
    setLocals({ paying: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makePhoto()] } });
    fireEvent.click(screen.getByText('Get cards'));

    await waitFor(() => {
      expect(screen.getByText(/Sign in to use photo to deck/)).toBeTruthy();
    });
  });

  it('shows the free-plan limit message on 429', async () => {
    setLocals({ paying: false });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ used: 5, limit: 5 }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makePhoto()] } });
    fireEvent.click(screen.getByText('Get cards'));

    await waitFor(() => {
      expect(
        screen.getByText(
          /Free plan is 5 photos per month\. Upgrade for unlimited\./
        )
      ).toBeTruthy();
    });
  });

  it('shows the too-large message on 413', async () => {
    setLocals({ paying: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 413 }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makePhoto()] } });
    fireEvent.click(screen.getByText('Get cards'));

    await waitFor(() => {
      expect(screen.getByText(/Photo is too large/)).toBeTruthy();
    });
  });

  it('shows the card-count success state when the deck arrives', async () => {
    setLocals({ paying: true });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('fake-apkg-bytes', {
        status: 200,
        headers: {
          'X-Card-Count': '12',
          'Content-Type': 'application/octet-stream',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const clickSpy = vi.fn();
    HTMLAnchorElement.prototype.click = clickSpy;

    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makePhoto('biology.jpg')] } });
    fireEvent.click(screen.getByText('Get cards'));

    await waitFor(() => {
      expect(
        screen.getByText(/12 cards from your photo\. Deck downloaded\./)
      ).toBeTruthy();
    });
    expect(clickSpy).toHaveBeenCalled();
  });

  it('renders the "Take a photo" button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeTruthy();
  });

  it('fires photo_upload_started with source: library when converting via dropzone input', async () => {
    setLocals({ paying: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makePhoto()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Get cards' }));

    await waitFor(() => {
      expect(mockTrack).toHaveBeenCalledWith('photo_upload_started', {
        source: 'library',
      });
    });
  });

  it('fires photo_upload_started with source: camera when converting via camera input', async () => {
    setLocals({ paying: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const cameraInput = document.getElementById(
      'photo-camera-input'
    ) as HTMLInputElement;
    fireEvent.change(cameraInput, { target: { files: [makePhoto()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Get cards' }));

    await waitFor(() => {
      expect(mockTrack).toHaveBeenCalledWith('photo_upload_started', {
        source: 'camera',
      });
    });
  });

  it('renders the card-count input with 10 as the default', () => {
    renderPage();
    const input = screen.getByLabelText('How many cards?') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.value).toBe('10');
    expect(input.min).toBe('1');
    expect(input.max).toBe('20');
    expect(
      screen.getByText(
        /3–5 for a quick pass, 6–10 for typical study, 11–20 for a dense page/
      )
    ).toBeTruthy();
  });

  it('maps a high card count (16) to density "dense" in the upload request', async () => {
    setLocals({ paying: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.change(screen.getByLabelText('How many cards?'), {
      target: { value: '16' },
    });
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makePhoto()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Get cards' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ density: 'dense' });
  });

  it('maps a low card count (3) to density "sparse" in the upload request', async () => {
    setLocals({ paying: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.change(screen.getByLabelText('How many cards?'), {
      target: { value: '3' },
    });
    const photoInput = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    fireEvent.change(photoInput, { target: { files: [makePhoto()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Get cards' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      density: 'sparse',
    });
  });

  it('persists the chosen card count to localStorage', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('How many cards?'), {
      target: { value: '4' },
    });
    expect(window.localStorage.getItem('photoToFlashcards.cardCount')).toBe(
      '4'
    );
  });

  it('restores the previously chosen card count from localStorage', () => {
    window.localStorage.setItem('photoToFlashcards.cardCount', '17');
    renderPage();
    expect(
      (screen.getByLabelText('How many cards?') as HTMLInputElement).value
    ).toBe('17');
  });

  it('clamps card count to the 1..20 range', () => {
    renderPage();
    const input = screen.getByLabelText('How many cards?') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99' } });
    expect(input.value).toBe('20');
    fireEvent.change(input, { target: { value: '0' } });
    expect(input.value).toBe('1');
  });

  it('fires photo_quota_reached with used and limit on 429', async () => {
    setLocals({ paying: false });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ used: 5, limit: 5 }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const input = document.getElementById(
      'photo-file-input'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makePhoto()] } });
    fireEvent.click(screen.getByText('Get cards'));

    await waitFor(() => {
      expect(
        screen.getByText(
          /Free plan is 5 photos per month\. Upgrade for unlimited\./
        )
      ).toBeTruthy();
    });
    expect(mockTrack).toHaveBeenCalledWith('photo_quota_reached', {
      used: 5,
      limit: 5,
    });
  });

  describe('mode toggle', () => {
    it('renders the mode radiogroup with Generate selected by default', () => {
      renderPage();
      const group = screen.getByRole('radiogroup', { name: 'Conversion mode' });
      expect(group).toBeTruthy();
      expect(
        screen.getByRole('radio', { name: 'Generate cards' })
      ).toHaveProperty('ariaChecked', 'true');
      expect(
        screen.getByRole('radio', { name: 'Copy existing questions' })
      ).toHaveProperty('ariaChecked', 'false');
    });

    it('selecting Copy existing questions unchecks Generate cards', () => {
      renderPage();
      fireEvent.click(
        screen.getByRole('radio', { name: 'Copy existing questions' })
      );
      expect(
        screen.getByRole('radio', { name: 'Generate cards' })
      ).toHaveProperty('ariaChecked', 'false');
      expect(
        screen.getByRole('radio', { name: 'Copy existing questions' })
      ).toHaveProperty('ariaChecked', 'true');
    });

    it('hides the card-count control when verbatim is selected', () => {
      renderPage();
      fireEvent.click(
        screen.getByRole('radio', { name: 'Copy existing questions' })
      );
      expect(screen.queryByLabelText('How many cards?')).toBeNull();
    });

    it('shows the card-count control when generative is selected', () => {
      renderPage();
      expect(screen.getByLabelText('How many cards?')).toBeTruthy();
    });

    it('sends mode: verbatim in the request body when verbatim is selected', async () => {
      setLocals({ paying: true });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 404 }));
      vi.stubGlobal('fetch', fetchMock);

      renderPage();
      fireEvent.click(
        screen.getByRole('radio', { name: 'Copy existing questions' })
      );
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [makePhoto()] } });
      fireEvent.click(screen.getByRole('button', { name: 'Get cards' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toMatchObject({
        mode: 'verbatim',
      });
    });

    it('sends mode: generative in the request body by default', async () => {
      setLocals({ paying: true });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 404 }));
      vi.stubGlobal('fetch', fetchMock);

      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [makePhoto()] } });
      fireEvent.click(screen.getByRole('button', { name: 'Get cards' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toMatchObject({
        mode: 'generative',
      });
    });

    it('shows both mode helpers regardless of selection', () => {
      renderPage();
      expect(screen.getByText(/AI writes the questions/)).toBeTruthy();
      expect(
        screen.getByText(/Cards are copied exactly as written/)
      ).toBeTruthy();
    });

    function noQuestionsResponse() {
      return new Response(
        JSON.stringify({
          message:
            'No ready-made questions found in this photo. Switch to Generate cards to make cards from this content.',
          code: 'no_ready_made_questions',
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    function okDeckResponse(cardCount = '8') {
      return new Response('fake-apkg-bytes', {
        status: 200,
        headers: {
          'X-Card-Count': cardCount,
          'Content-Type': 'application/octet-stream',
        },
      });
    }

    it('shows the no-ready-made-questions warning and a Try Generate cards button on the 422 code', async () => {
      setLocals({ paying: true });
      const fetchMock = vi.fn().mockResolvedValue(noQuestionsResponse());
      vi.stubGlobal('fetch', fetchMock);
      HTMLAnchorElement.prototype.click = vi.fn();

      renderPage();
      fireEvent.click(
        screen.getByRole('radio', { name: 'Copy existing questions' })
      );
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [makePhoto()] } });
      fireEvent.click(screen.getByRole('button', { name: 'Get cards' }));

      await waitFor(() => {
        expect(
          screen.getByText(/No ready-made questions found in this photo/)
        ).toBeTruthy();
      });
      expect(
        screen.getByRole('button', { name: 'Try Generate cards' })
      ).toBeTruthy();
      expect(mockTrack).toHaveBeenCalledWith('photo_verbatim_no_questions');
    });

    it('re-runs the same photo in generative mode when Try Generate cards is clicked', async () => {
      setLocals({ paying: true });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(noQuestionsResponse())
        .mockResolvedValueOnce(okDeckResponse('8'));
      vi.stubGlobal('fetch', fetchMock);
      HTMLAnchorElement.prototype.click = vi.fn();

      renderPage();
      fireEvent.click(
        screen.getByRole('radio', { name: 'Copy existing questions' })
      );
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [makePhoto()] } });
      fireEvent.click(screen.getByRole('button', { name: 'Get cards' }));

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Try Generate cards' })
        ).toBeTruthy();
      });

      fireEvent.click(
        screen.getByRole('button', { name: 'Try Generate cards' })
      );

      await waitFor(() => {
        expect(
          screen.getByText(/8 cards from your photo\. Deck downloaded\./)
        ).toBeTruthy();
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondBody = JSON.parse(
        (fetchMock.mock.calls[1][1] as RequestInit).body as string
      ) as { mode: string };
      expect(secondBody.mode).toBe('generative');
      expect(mockTrack).toHaveBeenCalledWith(
        'photo_verbatim_switch_to_generate'
      );
      expect(
        screen.queryByText(/No ready-made questions found in this photo/)
      ).toBeNull();
    });

    it('shows the generic read error (not the switch prompt) on an unreadable 422', async () => {
      setLocals({ paying: true });
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message:
              "Couldn't read the cards from this photo. Try a clearer or less dense image.",
            code: 'unreadable',
          }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        )
      );
      vi.stubGlobal('fetch', fetchMock);

      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [makePhoto()] } });
      fireEvent.click(screen.getByRole('button', { name: 'Get cards' }));

      await waitFor(() => {
        expect(
          screen.getByText(/Couldn't read the cards from this photo/)
        ).toBeTruthy();
      });
      expect(
        screen.queryByRole('button', { name: 'Try Generate cards' })
      ).toBeNull();
    });
  });

  describe('section cards layout', () => {
    it('renders four section cards in generative mode', () => {
      renderPage();
      const cards = document.querySelectorAll('[data-section-card]');
      expect(cards).toHaveLength(4);
    });

    it('renders three section cards in verbatim mode', () => {
      renderPage();
      fireEvent.click(
        screen.getByRole('radio', { name: 'Copy existing questions' })
      );
      const cards = document.querySelectorAll('[data-section-card]');
      expect(cards).toHaveLength(3);
    });
  });

  describe('source image toggle', () => {
    it('renders the source image toggle on by default', () => {
      renderPage();
      const toggle = screen.getByRole('switch', {
        name: /Show source image on the back of each card/,
      }) as HTMLInputElement;
      expect(toggle.checked).toBe(true);
    });

    it('sends includeSourceImage: true when checkbox is checked', async () => {
      setLocals({ paying: true });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 404 }));
      vi.stubGlobal('fetch', fetchMock);

      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [makePhoto()] } });
      fireEvent.click(screen.getByRole('button', { name: 'Get cards' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string
      ) as { includeSourceImage: boolean };
      expect(body.includeSourceImage).toBe(true);
    });

    it('sends includeSourceImage: false when checkbox is unchecked', async () => {
      setLocals({ paying: true });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 404 }));
      vi.stubGlobal('fetch', fetchMock);

      renderPage();
      const checkbox = screen.getByRole('switch', {
        name: /Show source image on the back of each card/,
      });
      fireEvent.click(checkbox);

      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [makePhoto()] } });
      fireEvent.click(screen.getByRole('button', { name: 'Get cards' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string
      ) as { includeSourceImage: boolean };
      expect(body.includeSourceImage).toBe(false);
    });
  });

  describe('multi-photo append behaviour', () => {
    function getThumbnails(): HTMLElement[] {
      return Array.from(
        document.querySelectorAll('[aria-label^="Remove "]')
      ) as HTMLElement[];
    }

    it('appends a second picker selection instead of replacing the first', () => {
      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [makePhoto('first.jpg')] } });
      fireEvent.change(input, { target: { files: [makePhoto('second.jpg')] } });
      expect(getThumbnails()).toHaveLength(2);
      expect(
        screen.getByRole('button', { name: 'Remove first.jpg' })
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Remove second.jpg' })
      ).toBeTruthy();
    });

    it('accepts multiple photos in a single picker invocation', () => {
      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, {
        target: {
          files: [makePhoto('a.jpg'), makePhoto('b.jpg'), makePhoto('c.jpg')],
        },
      });
      expect(getThumbnails()).toHaveLength(3);
    });

    it('appends drag-and-drop additions to the existing set', () => {
      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [makePhoto('one.jpg')] } });

      const dropzone = document.querySelector(
        'label[for="photo-file-input"]'
      ) as HTMLElement;
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [makePhoto('two.jpg'), makePhoto('three.jpg')] },
      });
      expect(getThumbnails()).toHaveLength(3);
    });

    it('appends clipboard-pasted images to the existing set', () => {
      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [makePhoto('one.jpg')] } });

      const dropzone = document.querySelector(
        'label[for="photo-file-input"]'
      ) as HTMLElement;
      fireEvent.paste(dropzone, {
        clipboardData: { files: [makePhoto('pasted.jpg')] },
      });
      expect(getThumbnails()).toHaveLength(2);
      expect(
        screen.getByRole('button', { name: 'Remove pasted.jpg' })
      ).toBeTruthy();
    });

    it('removes the targeted photo when its × button is clicked and leaves the rest', () => {
      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, {
        target: {
          files: [
            makePhoto('keep1.jpg'),
            makePhoto('drop.jpg'),
            makePhoto('keep2.jpg'),
          ],
        },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Remove drop.jpg' }));
      expect(getThumbnails()).toHaveLength(2);
      expect(
        screen.getByRole('button', { name: 'Remove keep1.jpg' })
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Remove keep2.jpg' })
      ).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: 'Remove drop.jpg' })
      ).toBeNull();
    });

    it('returns to the empty state after removing the last thumbnail', () => {
      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [makePhoto('only.jpg')] } });
      expect(getThumbnails()).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Remove only.jpg' }));
      expect(getThumbnails()).toHaveLength(0);
      expect(
        screen.getByText('Drop photos, paste, or click to add')
      ).toBeTruthy();
    });

    it('keeps duplicate filenames in the same batch (one is allowed)', () => {
      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, {
        target: { files: [makePhoto('same.jpg'), makePhoto('same.jpg')] },
      });
      expect(getThumbnails()).toHaveLength(2);
    });

    it('the Convert CTA reflects the photo count after each addition', () => {
      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [makePhoto('a.jpg')] } });
      expect(screen.getByRole('button', { name: 'Get cards' })).toBeTruthy();
      fireEvent.change(input, { target: { files: [makePhoto('b.jpg')] } });
      expect(
        screen.getByRole('button', { name: 'Get cards from 2 photos' })
      ).toBeTruthy();
      fireEvent.change(input, { target: { files: [makePhoto('c.jpg')] } });
      expect(
        screen.getByRole('button', { name: 'Get cards from 3 photos' })
      ).toBeTruthy();
    });

    it('rejects an invalid file in a mixed batch but keeps the valid ones', () => {
      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
      fireEvent.change(input, {
        target: { files: [makePhoto('ok.jpg'), pdf] },
      });
      expect(getThumbnails()).toHaveLength(1);
      expect(
        screen.getByText(
          'Use a photo format like JPEG, PNG, WebP, GIF, or HEIC.'
        )
      ).toBeTruthy();
    });

    it('exposes a multiple-file input so picker allows in-batch multi-select', () => {
      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      expect(input.multiple).toBe(true);
    });

    it('uploads each photo sequentially when converting a multi-photo set', async () => {
      setLocals({ paying: true });
      const makeOkResponse = () =>
        new Response('fake-apkg-bytes', {
          status: 200,
          headers: {
            'X-Card-Count': '5',
            'Content-Type': 'application/octet-stream',
          },
        });
      const fetchMock = vi
        .fn()
        .mockImplementation(async () => makeOkResponse());
      vi.stubGlobal('fetch', fetchMock);
      HTMLAnchorElement.prototype.click = vi.fn();

      renderPage();
      const input = document.getElementById(
        'photo-file-input'
      ) as HTMLInputElement;
      fireEvent.change(input, {
        target: { files: [makePhoto('a.jpg'), makePhoto('b.jpg')] },
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Get cards from 2 photos' })
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await waitFor(() => {
        expect(
          screen.getByText(/10 cards from 2 photos\. Decks downloaded\./)
        ).toBeTruthy();
      });
    });
  });
});

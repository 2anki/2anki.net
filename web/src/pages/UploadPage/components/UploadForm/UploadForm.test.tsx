import {
  render,
  act,
  waitFor,
  fireEvent,
  screen,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  test,
  vi,
  type Mock,
} from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import UploadForm from './UploadForm';
import i18n from '../../../../lib/i18n';

vi.mock('../../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

vi.mock('../../../../lib/hooks/useUserLocals', () => ({
  useUserLocals: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    error: null,
    isError: false,
    refetch: vi.fn(),
  })),
}));

vi.mock('../../../../lib/hooks/readUserLocalsOnce', () => ({
  readUserLocalsOnce: vi.fn(() => Promise.reject(new Error('locals'))),
}));

vi.mock('../../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: vi.fn(() => ({
    startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
    getUploads: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../../../lib/reportClientError', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../../lib/reportClientError')
  >()),
  reportClientError: vi.fn(),
}));

vi.mock('../../../../lib/hooks/useCardUsage', () => ({
  useCardUsage: vi.fn(() => null),
  CARD_USAGE_QUERY_KEY: ['cardUsage'],
}));

vi.mock('../../../../lib/hooks/usePassPrices', () => ({
  usePassPrices: () => ({ '24h': '$6', '7d': '$12', '120d': '$29' }),
}));

vi.mock('./dropWaitPlan', () => ({
  dropWaitDelays: vi.fn(() => []),
}));

import { dropWaitDelays } from './dropWaitPlan';
import { useUserLocals } from '../../../../lib/hooks/useUserLocals';
import { readUserLocalsOnce } from '../../../../lib/hooks/readUserLocalsOnce';
import {
  THIN_DECK_RESUME_WAIT_MS,
  clearThinDeckResume,
  markThinDeckResume,
  thinDeckResumeMarked,
} from '../ThinDeckAiOffer/thinDeckResume';
import { useCardUsage } from '../../../../lib/hooks/useCardUsage';
import { get2ankiApi } from '../../../../lib/backend/get2ankiApi';
import { track } from '../../../../lib/analytics/track';
import { reportClientError } from '../../../../lib/reportClientError';
import { UserNotice } from '../../../../lib/errors/UserNotice';
import {
  getPendingUploadStore,
  resetPendingUploadStoreForTests,
  type PendingUpload,
} from '../../../../lib/upload/pendingUpload';
import { storePassToken } from '../../../../lib/anonymousPass';
import {
  getLastDeckStore,
  resetLastDeckStoreForTests,
} from '../../../../lib/upload/lastDeck';
import {
  RecoveryStorageBusyError,
  RecoveryUnavailableError,
} from '../../../../lib/backend/Backend';

const mockReportClientError = vi.mocked(reportClientError);
const mockUseUserLocals = vi.mocked(useUserLocals);
const mockReadUserLocalsOnce = vi.mocked(readUserLocalsOnce);
const mockUseCardUsage = vi.mocked(useCardUsage);
const mockGet2ankiApi = vi.mocked(get2ankiApi);

beforeEach(() => {
  resetPendingUploadStoreForTests();
  resetLastDeckStoreForTests();
  mockReadUserLocalsOnce.mockReset();
  mockReadUserLocalsOnce.mockRejectedValue(new Error('locals'));
});

type AnalyticsGlobals = {
  hj?: ReturnType<typeof vi.fn>;
  gtag?: ReturnType<typeof vi.fn>;
};

function renderUploadForm(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
}

function stubPassReturn(passSession: string): void {
  vi.stubGlobal('location', {
    search: `?pass_session=${passSession}`,
    href: `http://localhost/upload?pass_session=${passSession}`,
    origin: 'http://localhost',
  });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:deck');
}

function apkgResumeResponse(): Response {
  return {
    status: 200,
    redirected: false,
    headers: new Headers({
      'Content-Type': 'application/octet-stream',
      'X-Card-Count': '58',
      'File-Name': 'notes.apkg',
    }),
    blob: () => Promise.resolve(new Blob(['APKG'])),
  } as unknown as Response;
}

function okApkgFetch(): Mock {
  return vi.fn().mockResolvedValue({
    redirected: false,
    status: 200,
    headers: new Headers({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="deck.apkg"',
      'X-Card-Count': '5',
    }),
    blob: () => Promise.resolve(new Blob(['fake'])),
  });
}

function aiFlagFromFetch(fetchMock: Mock, url: string): string | null {
  const call = fetchMock.mock.calls.find((c) => c[0] === url);
  const body = call?.[1]?.body as FormData | undefined;
  return body ? (body.get('claude-ai-flashcards') as string | null) : null;
}

function installResumeApi(resumeAiPreview: Mock): () => void {
  const previousImpl = mockGet2ankiApi.getMockImplementation();
  mockGet2ankiApi.mockReturnValue({
    startPassCheckout: vi.fn(),
    getUploads: vi.fn().mockResolvedValue([]),
    getHeldDeck: vi.fn().mockResolvedValue(null),
    resumeAiPreview,
  } as unknown as ReturnType<typeof get2ankiApi>);
  return () => {
    mockGet2ankiApi.mockReset();
    if (previousImpl) mockGet2ankiApi.mockImplementation(previousImpl);
  };
}

describe('UploadForm', () => {
  afterEach(() => {
    globalThis.localStorage.removeItem('2anki_pass_token');
    vi.unstubAllGlobals();
  });

  test('no null classes', () => {
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    expect(container.querySelector('.null')).toBeNull();
  });

  test('resumes the AI preview on return from checkout, using the fresh pass token', async () => {
    // A stale token from a previous visit must not win over this return's.
    globalThis.localStorage.setItem('2anki_pass_token', 'cs_stale');
    stubPassReturn('cs_fresh');
    const resumeAiPreview = vi.fn().mockResolvedValue(apkgResumeResponse());
    const restore = installResumeApi(resumeAiPreview);

    try {
      renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
      await waitFor(() =>
        expect(resumeAiPreview).toHaveBeenCalledWith('cs_fresh')
      );
    } finally {
      restore();
    }
  });

  test('resumes for a first-time buyer with no stored token, using the return token', async () => {
    // No token in localStorage: the only source is this return's URL param.
    const resumeAiPreview = vi.fn().mockResolvedValue(apkgResumeResponse());
    stubPassReturn('cs_firsttime');
    const restore = installResumeApi(resumeAiPreview);

    try {
      renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
      await waitFor(() =>
        expect(resumeAiPreview).toHaveBeenCalledWith('cs_firsttime')
      );
    } finally {
      restore();
    }
  });

  test('shows the drop-again notice when the resume finds no preview', async () => {
    stubPassReturn('cs_gone');
    const resumeAiPreview = vi.fn().mockResolvedValue({
      status: 404,
      redirected: false,
      headers: new Headers(),
    } as unknown as Response);
    const restore = installResumeApi(resumeAiPreview);

    try {
      renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
      expect(
        await screen.findByText(
          /Your Day Pass is active\. Drop your file again to get every card\./
        )
      ).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test('shows the out-of-credits notice when the resume is refused for credits', async () => {
    stubPassReturn('cs_nocredits');
    const resumeAiPreview = vi.fn().mockResolvedValue({
      status: 402,
      redirected: false,
      headers: new Headers(),
    } as unknown as Response);
    const restore = installResumeApi(resumeAiPreview);

    try {
      renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
      expect(
        await screen.findByText(/no AI credits left right now/)
      ).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test('a signed-out upload with a hidden toggle sends AI off, ignoring a leftover localStorage key', async () => {
    // Simulates a landing page other than the AI page: the toggle is hidden
    // (no aiOn prop) but an old session left claude-ai-flashcards=true.
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    const fetchMock = vi.fn().mockResolvedValue({
      redirected: false,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="deck.apkg"',
        'X-Card-Count': '5',
      }),
      blob: () => Promise.resolve(new Blob(['fake'])),
    });
    vi.stubGlobal('fetch', fetchMock);
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');

    try {
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
      });

      const call = fetchMock.mock.calls.find(
        (c) => c[0] === '/api/upload/file'
      );
      expect(call).toBeDefined();
      const body = call![1].body as FormData;
      expect(body.get('claude-ai-flashcards')).toBe('false');
    } finally {
      globalThis.localStorage.removeItem('claude-ai-flashcards');
    }
  });

  test('a signed-out upload with the toggle on sends AI on', async () => {
    const fetchMock = okApkgFetch();
    vi.stubGlobal('fetch', fetchMock);
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });
    expect(aiFlagFromFetch(fetchMock, '/api/upload/file')).toBe('true');
  });

  test('a signed-out pass holder keeps their stored AI setting even with the flag off', async () => {
    // A pass holder is treated as paying; flag-off must not strip their AI.
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    globalThis.localStorage.setItem('2anki_pass_token', 'cs_pass');
    const fetchMock = okApkgFetch();
    vi.stubGlobal('fetch', fetchMock);
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    try {
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
      });
      expect(aiFlagFromFetch(fetchMock, '/api/upload/file')).toBe('true');
    } finally {
      globalThis.localStorage.removeItem('claude-ai-flashcards');
      globalThis.localStorage.removeItem('2anki_pass_token');
    }
  });

  test('a signed-in upload keeps the localStorage AI setting', async () => {
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    mockUseUserLocals.mockReturnValue({
      data: {
        user: { id: 1 },
        locals: { patreon: true, subscriber: false },
        features: {},
      },
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
    const fetchMock = okApkgFetch();
    vi.stubGlobal('fetch', fetchMock);
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    try {
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
      });
      expect(aiFlagFromFetch(fetchMock, '/api/upload/file')).toBe('true');
    } finally {
      globalThis.localStorage.removeItem('claude-ai-flashcards');
      // Restore a clean signed-out default so later tests don't inherit a
      // signed-in user (mockReset would leave an undefined return).
      mockUseUserLocals.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useUserLocals>);
    }
  });

  test('a signed-out Dropbox upload sends AI off despite a leftover key', async () => {
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    const previousKey = process.env.REACT_APP_DROPBOX_APP_KEY;
    process.env.REACT_APP_DROPBOX_APP_KEY = 'test-key';
    (window as unknown as { Dropbox?: unknown }).Dropbox = {
      choose: ({ success }: { success: (files: unknown[]) => void }) => {
        success([
          {
            id: 'id:2',
            name: 'notes.pdf',
            bytes: 100,
            icon: 'page',
            isDir: false,
            link: 'https://dl.dropboxusercontent.com/x/notes.pdf',
            linkType: 'direct',
          },
        ]);
      },
    };
    const fetchMock = okApkgFetch();
    vi.stubGlobal('fetch', fetchMock);
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    try {
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      const button = container.querySelector(
        'button[aria-label="Choose from Dropbox"]'
      ) as HTMLButtonElement;
      await act(async () => {
        button.click();
      });
      await waitFor(() =>
        expect(aiFlagFromFetch(fetchMock, '/api/upload/dropbox')).toBe('false')
      );
    } finally {
      delete (window as unknown as { Dropbox?: unknown }).Dropbox;
      process.env.REACT_APP_DROPBOX_APP_KEY = previousKey;
      globalThis.localStorage.removeItem('claude-ai-flashcards');
    }
  });

  test('opts the drop zone out of browser translation', () => {
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    expect(container.querySelector('#upload-panel-local')).toHaveAttribute(
      'translate',
      'no'
    );
  });

  test('renders the Google Drive chip enabled when env vars are configured', () => {
    const previousClient = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    const previousKey = process.env.REACT_APP_GOOGLE_API_KEY;
    process.env.REACT_APP_GOOGLE_CLIENT_ID = 'test-client';
    process.env.REACT_APP_GOOGLE_API_KEY = 'AIza' + 'fake-test-key';
    try {
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      const chip = within(container).getByRole('button', {
        name: 'Google Drive',
      });
      expect(chip?.hasAttribute('disabled')).toBe(false);
    } finally {
      process.env.REACT_APP_GOOGLE_CLIENT_ID = previousClient;
      process.env.REACT_APP_GOOGLE_API_KEY = previousKey;
    }
  });

  test('renders the Drive shape-hint with its own shapeHint class', () => {
    const previousClient = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    const previousKey = process.env.REACT_APP_GOOGLE_API_KEY;
    process.env.REACT_APP_GOOGLE_CLIENT_ID = 'test-client';
    process.env.REACT_APP_GOOGLE_API_KEY = 'AIza' + 'fake-test-key';
    try {
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      const hint = Array.from(
        container.querySelectorAll('#upload-panel-google-drive span')
      ).find((el) => el.textContent?.includes('Docs work best'));
      expect(hint).toBeDefined();
      expect(hint?.className).toMatch(/shapeHint/);
      expect(hint?.className).not.toMatch(/dropHint/);
    } finally {
      process.env.REACT_APP_GOOGLE_CLIENT_ID = previousClient;
      process.env.REACT_APP_GOOGLE_API_KEY = previousKey;
    }
  });

  test('renders the Google Drive chip disabled when env vars are missing', () => {
    const previousClient = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    const previousKey = process.env.REACT_APP_GOOGLE_API_KEY;
    process.env.REACT_APP_GOOGLE_CLIENT_ID = '';
    process.env.REACT_APP_GOOGLE_API_KEY = '';
    try {
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      const chip = within(container).getByRole('button', {
        name: 'Google Drive',
      });
      expect(chip?.hasAttribute('disabled')).toBe(true);
    } finally {
      process.env.REACT_APP_GOOGLE_CLIENT_ID = previousClient;
      process.env.REACT_APP_GOOGLE_API_KEY = previousKey;
    }
  });
});

describe('UploadForm Google Drive picker interaction', () => {
  const previousClient = process.env.REACT_APP_GOOGLE_CLIENT_ID;
  const previousKey = process.env.REACT_APP_GOOGLE_API_KEY;

  type GoogleGlobal = {
    picker?: unknown;
    accounts?: { oauth2?: unknown };
  };

  function stubGoogleDriveCancel() {
    (window as unknown as { gapi: unknown }).gapi = {
      load: (_lib: string, cb: () => void) => cb(),
    };
    (window as unknown as { google: GoogleGlobal }).google = {
      picker: {
        PickerBuilder: function PickerBuilder() {
          const builder: Record<string, unknown> = {};
          builder.setAppId = vi.fn().mockReturnValue(builder);
          builder.setOAuthToken = vi.fn().mockReturnValue(builder);
          builder.setDeveloperKey = vi.fn().mockReturnValue(builder);
          builder.addView = vi.fn().mockReturnValue(builder);
          builder.setCallback = vi.fn().mockImplementation((cb) => {
            queueMicrotask(() => cb({ action: 'cancel' }));
            return builder;
          });
          builder.build = vi.fn().mockReturnValue({ setVisible: vi.fn() });
          return builder;
        },
        ViewId: { DOCS: 'DOCS' },
        Action: { PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' },
        DocsView: function DocsView() {
          return { setIncludeFolders: vi.fn().mockReturnThis() };
        },
      },
      accounts: {
        oauth2: {
          initTokenClient: ({
            callback,
          }: {
            callback: (resp: { access_token?: string }) => void;
          }) => ({
            callback,
            requestAccessToken: () => callback({ access_token: 'tok' }),
          }),
        },
      },
    };
  }

  beforeEach(() => {
    process.env.REACT_APP_GOOGLE_CLIENT_ID = 'test-client';
    process.env.REACT_APP_GOOGLE_API_KEY = 'AIza' + 'fake-test-key';
  });

  afterEach(() => {
    process.env.REACT_APP_GOOGLE_CLIENT_ID = previousClient;
    process.env.REACT_APP_GOOGLE_API_KEY = previousKey;
    delete (window as unknown as { gapi?: unknown }).gapi;
    delete (window as unknown as { google?: GoogleGlobal }).google;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('scrolls to the top before opening the picker and restores focus to the button once it settles', async () => {
    stubGoogleDriveCancel();
    const scrollToSpy = vi.fn();
    vi.stubGlobal('scrollTo', scrollToSpy);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );

    fireEvent.click(
      within(container).getByRole('button', { name: 'Google Drive' })
    );
    const driveButton = await screen.findByRole('button', {
      name: 'Choose from Google Drive',
    });

    fireEvent.click(driveButton);

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });

    await waitFor(() => expect(driveButton).toHaveFocus());
  });

  function stubGoogleDrivePicked() {
    (window as unknown as { gapi: unknown }).gapi = {
      load: (_lib: string, cb: () => void) => cb(),
    };
    (window as unknown as { google: GoogleGlobal }).google = {
      picker: {
        PickerBuilder: function PickerBuilder() {
          const builder: Record<string, unknown> = {};
          builder.setAppId = vi.fn().mockReturnValue(builder);
          builder.setOAuthToken = vi.fn().mockReturnValue(builder);
          builder.setDeveloperKey = vi.fn().mockReturnValue(builder);
          builder.addView = vi.fn().mockReturnValue(builder);
          builder.setCallback = vi.fn().mockImplementation((cb) => {
            queueMicrotask(() =>
              cb({
                action: 'picked',
                docs: [
                  {
                    id: 'd1',
                    name: 'notes.pdf',
                    mimeType: 'application/pdf',
                    iconUrl: '',
                    url: '',
                    sizeBytes: 1000,
                  },
                ],
              })
            );
            return builder;
          });
          builder.build = vi.fn().mockReturnValue({ setVisible: vi.fn() });
          return builder;
        },
        ViewId: { DOCS: 'DOCS' },
        Action: { PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' },
        DocsView: function DocsView() {
          return { setIncludeFolders: vi.fn().mockReturnThis() };
        },
      },
      accounts: {
        oauth2: {
          initTokenClient: ({
            callback,
          }: {
            callback: (resp: { access_token?: string }) => void;
          }) => ({
            callback,
            requestAccessToken: () => callback({ access_token: 'tok' }),
          }),
        },
      },
    };
  }

  it('sends the captured page range on the Drive upload and clears localStorage', async () => {
    stubGoogleDrivePicked();
    vi.stubGlobal('scrollTo', vi.fn());
    const fetchMock = vi.fn().mockResolvedValue({
      redirected: false,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="deck.apkg"',
        'X-Card-Count': '3',
      }),
      blob: () => Promise.resolve(new Blob(['fake'])),
    });
    vi.stubGlobal('fetch', fetchMock);
    globalThis.localStorage.setItem('pdf-page-range', '2-4');

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    fireEvent.click(
      within(container).getByRole('button', { name: 'Google Drive' })
    );
    const driveButton = await screen.findByRole('button', {
      name: 'Choose from Google Drive',
    });
    fireEvent.click(driveButton);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.find(
          (call) => call[0] === '/api/upload/google_drive'
        )
      ).toBeDefined()
    );
    const driveCall = fetchMock.mock.calls.find(
      (call) => call[0] === '/api/upload/google_drive'
    )!;
    const body = driveCall[1].body as FormData;
    expect(body.get('pdf-page-range')).toBe('2-4');
    expect(globalThis.localStorage.getItem('pdf-page-range')).toBeNull();
  });

  it('keeps the card count when a signed-out Drive import hits the anonymous limit with pass-first on', async () => {
    mockUseUserLocals.mockReturnValue({
      data: {
        user: null,
        locals: {},
        features: { kiUI: false, limitWallPassFirst: true },
      },
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
    stubGoogleDrivePicked();
    vi.stubGlobal('scrollTo', vi.fn());
    const locationStub = { href: '', origin: 'http://localhost' } as Location;
    vi.stubGlobal('location', locationStub);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: true,
        url: 'http://localhost/limit?kind=anonymous&cards=184',
        status: 200,
        headers: new Headers({}),
        blob: () => Promise.resolve(new Blob([])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    fireEvent.click(
      within(container).getByRole('button', { name: 'Google Drive' })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Choose from Google Drive' })
    );

    await waitFor(() => {
      expect(locationStub.href).toBe('/limit?kind=anonymous&cards=184');
    });
  });

  it('sends AI off on a signed-out Drive upload despite a leftover localStorage key', async () => {
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    stubGoogleDrivePicked();
    vi.stubGlobal('scrollTo', vi.fn());
    const fetchMock = okApkgFetch();
    vi.stubGlobal('fetch', fetchMock);
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    try {
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      fireEvent.click(
        within(container).getByRole('button', { name: 'Google Drive' })
      );
      const driveButton = await screen.findByRole('button', {
        name: 'Choose from Google Drive',
      });
      fireEvent.click(driveButton);
      await waitFor(() =>
        expect(aiFlagFromFetch(fetchMock, '/api/upload/google_drive')).toBe(
          'false'
        )
      );
    } finally {
      globalThis.localStorage.removeItem('claude-ai-flashcards');
    }
  });

  it('says what a Drive PDF made, without asking first', async () => {
    stubGoogleDrivePicked();
    vi.stubGlobal('scrollTo', vi.fn());
    const fetchMock = vi.fn().mockResolvedValue({
      redirected: false,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'X-Card-Count': '7',
        'X-Pdf-Fallback': 'pairs',
      }),
      blob: () => Promise.resolve(new Blob(['apkg'])),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    fireEvent.click(
      within(container).getByRole('button', { name: 'Google Drive' })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Choose from Google Drive' })
    );

    expect(
      await screen.findByText(
        'Every 2 pages became 1 card, as pictures of the pages.'
      )
    ).toBeInTheDocument();
    const driveCall = fetchMock.mock.calls.find(
      (call) => call[0] === '/api/upload/google_drive'
    )!;
    expect((driveCall[1].body as FormData).get('pdf-fallback')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Two pages per card' })
    ).toBeNull();
  });

  it('offers no Claude rebuild for a Drive PDF picked after a local upload', async () => {
    mockUseUserLocals.mockReturnValue({
      data: {
        user: { id: 7 },
        locals: { patreon: false, subscriber: true },
        features: {},
      },
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
      getUploads: vi.fn().mockResolvedValue([]),
      getHeldDeck: vi.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof get2ankiApi>);
    globalThis.localStorage.setItem('claude-ai-flashcards', 'false');
    stubGoogleDrivePicked();
    vi.stubGlobal('scrollTo', vi.fn());
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/ai/credits'
          ? new Response(
              JSON.stringify({
                credits: 1347,
                used: 153,
                allowance: 1500,
                usable: true,
                windowEnd: null,
                resets: 'pass',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          : {
              redirected: false,
              status: 200,
              headers: new Headers({
                'Content-Type': 'application/octet-stream',
                'X-Card-Count': '64',
              }),
              blob: () => Promise.resolve(new Blob(['apkg'])),
            }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    try {
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      Object.defineProperty(fileInput, 'files', {
        value: [new File(['x'], 'lecture.pdf')],
        configurable: true,
      });
      await act(async () => {
        container
          .querySelector('form')!
          .dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true })
          );
      });
      expect(
        await screen.findByRole('button', { name: 'Rebuild with Claude' })
      ).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole('button', { name: 'Make another deck' })
      );

      fireEvent.click(
        within(container).getByRole('button', { name: 'Google Drive' })
      );
      fireEvent.click(
        await screen.findByRole('button', { name: 'Choose from Google Drive' })
      );

      await waitFor(() =>
        expect(
          fetchMock.mock.calls.filter(
            ([url]) => url === '/api/upload/google_drive'
          )
        ).toHaveLength(1)
      );
      await screen.findByRole('button', { name: 'Make another deck' });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(
        screen.queryByRole('button', { name: 'Rebuild with Claude' })
      ).toBeNull();
    } finally {
      globalThis.localStorage.removeItem('claude-ai-flashcards');
      mockUseUserLocals.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useUserLocals>);
      mockGet2ankiApi.mockReturnValue({
        startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
        getUploads: vi.fn().mockResolvedValue([]),
      } as unknown as ReturnType<typeof get2ankiApi>);
    }
  });
});

describe('UploadForm analytics events', () => {
  beforeEach(() => {
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    mockUseUserLocals.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
  });

  afterEach(() => {
    delete (globalThis as AnalyticsGlobals).gtag;
    delete (globalThis as AnalyticsGlobals).hj;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fires upload_started when the form is submitted', async () => {
    const gtag = (globalThis as AnalyticsGlobals).gtag!;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="deck.apkg"',
          'X-Card-Count': '5',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(gtag).toHaveBeenCalledWith('event', 'upload_started');
  });

  it('records upload_submitted with the file type and size bucket, never the name', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {}))
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const notes = new File(['# notes'], 'Private Lecture Notes.md');
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [notes],
      configurable: true,
    });
    input.removeAttribute('required');
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
    });

    expect(trackMock).toHaveBeenCalledWith('upload_submitted', {
      input_format: 'md',
      size_bucket: '<1MB',
      file_count: 1,
      trigger: 'submit',
      retry: false,
    });
    expect(JSON.stringify(trackMock.mock.calls)).not.toContain(
      'Private Lecture Notes'
    );
  });

  it('does not fire the DB-backed upload_started track on file submit (server owns it)', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="deck.apkg"',
          'X-Card-Count': '5',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    const startedCalls = trackMock.mock.calls.filter(
      ([name]) => name === 'upload_started'
    );
    expect(startedCalls).toHaveLength(0);
  });

  it('does not fire the DB-backed upload_started track when Dropbox chooser returns a file', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    const previousKey = process.env.REACT_APP_DROPBOX_APP_KEY;
    process.env.REACT_APP_DROPBOX_APP_KEY = 'test-key';
    (window as unknown as { Dropbox?: unknown }).Dropbox = {
      choose: ({ success }: { success: (files: unknown[]) => void }) => {
        success([
          {
            id: 'id:2',
            name: 'notes.pdf',
            bytes: 100,
            icon: 'page',
            isDir: false,
            link: 'https://dl.dropboxusercontent.com/x/notes.pdf',
            linkType: 'direct',
          },
        ]);
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      redirected: false,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="deck.apkg"',
        'X-Card-Count': '3',
      }),
      blob: () => Promise.resolve(new Blob(['fake'])),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const button = container.querySelector(
      'button[aria-label="Choose from Dropbox"]'
    ) as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.find((call) => call[0] === '/api/upload/dropbox')
      ).toBeDefined()
    );

    const startedCalls = trackMock.mock.calls.filter(
      ([name]) => name === 'upload_started'
    );
    expect(startedCalls).toHaveLength(0);

    delete (window as unknown as { Dropbox?: unknown }).Dropbox;
    process.env.REACT_APP_DROPBOX_APP_KEY = previousKey;
  });

  it('fires upload_cancelled once on pagehide while a conversion is in flight', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {}))
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await act(async () => {
      globalThis.dispatchEvent(new Event('pagehide'));
      globalThis.dispatchEvent(new Event('pagehide'));
    });

    const cancelledCalls = trackMock.mock.calls.filter(
      ([name]) => name === 'upload_cancelled'
    );
    expect(cancelledCalls).toHaveLength(1);
    expect(cancelledCalls[0][1]).toEqual({ stage: 'converting' });
  });

  async function submitAndGetHarness(response: Record<string, unknown>) {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    const locationStub = { href: '', origin: 'http://localhost' } as Location;
    vi.stubGlobal('location', locationStub);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    const cancelCount = () =>
      trackMock.mock.calls.filter(([name]) => name === 'upload_cancelled')
        .length;
    return { locationStub, cancelCount };
  }

  const asyncJobAccepted = {
    redirected: false,
    status: 202,
    url: 'http://localhost/api/upload/file',
    headers: new Headers(),
  };

  it('does not fire upload_cancelled when the async job path redirects to downloads', async () => {
    const { locationStub, cancelCount } =
      await submitAndGetHarness(asyncJobAccepted);

    expect(locationStub.href).toBe('/downloads?started=1');

    await act(async () => {
      globalThis.dispatchEvent(new Event('pagehide'));
    });

    expect(cancelCount()).toBe(0);
  });

  it('follows a non-limit server redirect and does not count it as a cancel', async () => {
    const { locationStub, cancelCount } = await submitAndGetHarness({
      redirected: true,
      status: 200,
      url: 'http://localhost/upload',
      headers: new Headers(),
    });

    expect(locationStub.href).toBe('http://localhost/upload');

    await act(async () => {
      globalThis.dispatchEvent(new Event('pagehide'));
    });

    expect(cancelCount()).toBe(0);
  });

  it('stays silent when a completed conversion is restored from bfcache', async () => {
    const { cancelCount } = await submitAndGetHarness(asyncJobAccepted);

    await act(async () => {
      globalThis.dispatchEvent(new Event('pagehide'));
      globalThis.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true })
      );
      globalThis.dispatchEvent(new Event('pagehide'));
    });

    expect(cancelCount()).toBe(0);
  });

  it('does not fire upload_cancelled on pagehide when no conversion is in flight', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);

    await act(async () => {
      globalThis.dispatchEvent(new Event('pagehide'));
    });

    const cancelledCalls = trackMock.mock.calls.filter(
      ([name]) => name === 'upload_cancelled'
    );
    expect(cancelledCalls).toHaveLength(0);
  });

  it('does not fire conversion_success on a successful conversion with cards', async () => {
    const gtag = (globalThis as AnalyticsGlobals).gtag!;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="deck.apkg"',
          'X-Card-Count': '5',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(gtag).not.toHaveBeenCalledWith('event', 'conversion_success');
  });

  it('shows the AI credits used when the X-Credits-Used header is present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="deck.apkg"',
          'X-Card-Count': '5',
          'X-Credits-Used': '88',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(
      screen.getByText('This deck used 88 AI credits.')
    ).toBeInTheDocument();
  });

  it('shows no AI-credits line when the X-Credits-Used header is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="deck.apkg"',
          'X-Card-Count': '5',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(screen.queryByText(/AI credit/)).toBeNull();
  });

  it('shows the structure-rescue notice when the X-Structure-Rescued header is present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="deck.apkg"',
          'X-Card-Count': '5',
          'X-Structure-Rescued': 'heading',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(
      screen.getByText(/Cards built from the headings/)
    ).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('structure_rescued_notice_shown', {
      rule: 'heading',
      source: 'upload',
    });
  });

  it('does not show the structure-rescue notice on a normal conversion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="deck.apkg"',
          'X-Card-Count': '5',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(screen.queryByText(/Cards built from the/)).toBeNull();
  });

  it('offers no rescue buttons when a Dropbox file makes no cards', async () => {
    const previousKey = process.env.REACT_APP_DROPBOX_APP_KEY;
    process.env.REACT_APP_DROPBOX_APP_KEY = 'test-key';
    (window as unknown as { Dropbox?: unknown }).Dropbox = {
      choose: ({ success }: { success: (files: unknown[]) => void }) => {
        success([
          {
            id: 'id:1',
            name: 'prose.html',
            bytes: 200,
            icon: 'page_white',
            isDir: false,
            link: 'https://dl.dropboxusercontent.com/x/prose.html',
            linkType: 'direct',
          },
        ]);
      },
    };
    const jsonBody = {
      code: 'empty_export',
      message: 'No cards were found in this file.',
      filename: 'prose.html',
      docsLink: '/documentation/help/common-problems',
      empty_reason: 'no_toggles',
      rescue: [{ rule: 'heading', cards: 2 }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(jsonBody) }),
        json: () => Promise.resolve(jsonBody),
        text: () => Promise.resolve(JSON.stringify(jsonBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const chooser = Array.from(container.querySelectorAll('button')).find((b) =>
      /dropbox/i.test(b.textContent ?? '')
    );
    expect(chooser).toBeDefined();
    await act(async () => {
      chooser!.click();
    });

    await waitFor(() => {
      expect(container.querySelector('[class*="emptyTitle"]')).not.toBeNull();
    });
    expect(container.querySelector('[class*="rescueButton"]')).toBeNull();
    process.env.REACT_APP_DROPBOX_APP_KEY = previousKey;
  });

  it('posts to /api/upload/dropbox when the chooser returns a file', async () => {
    const previousKey = process.env.REACT_APP_DROPBOX_APP_KEY;
    process.env.REACT_APP_DROPBOX_APP_KEY = 'test-key';
    (window as unknown as { Dropbox?: unknown }).Dropbox = {
      choose: ({ success }: { success: (files: unknown[]) => void }) => {
        success([
          {
            id: 'id:1',
            name: 'pharm.pdf',
            bytes: 200,
            icon: 'page_white_acrobat',
            isDir: false,
            link: 'https://dl.dropboxusercontent.com/x/pharm.pdf',
            linkType: 'direct',
          },
        ]);
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      redirected: false,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="deck.apkg"',
        'X-Card-Count': '7',
      }),
      blob: () => Promise.resolve(new Blob(['fake'])),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const button = container.querySelector(
      'button[aria-label="Choose from Dropbox"]'
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    await act(async () => {
      button.click();
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.find((call) => call[0] === '/api/upload/dropbox')
      ).toBeDefined()
    );
    const dropboxCall = fetchMock.mock.calls.find(
      (call) => call[0] === '/api/upload/dropbox'
    )!;
    expect(dropboxCall[1]).toEqual(expect.objectContaining({ method: 'post' }));
    const body = dropboxCall[1].body as FormData;
    expect(JSON.parse(body.get('files') as string)).toEqual([
      expect.objectContaining({ name: 'pharm.pdf', linkType: 'direct' }),
    ]);

    delete (window as unknown as { Dropbox?: unknown }).Dropbox;
    process.env.REACT_APP_DROPBOX_APP_KEY = previousKey;
  });

  it('shows the local panel and hides the Dropbox panel by default', () => {
    const previousKey = process.env.REACT_APP_DROPBOX_APP_KEY;
    process.env.REACT_APP_DROPBOX_APP_KEY = 'test-key';
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const localPanel = container.querySelector('#upload-panel-local')!;
    const dropboxPanel = container.querySelector('#upload-panel-dropbox')!;
    expect(localPanel.getAttribute('aria-hidden')).toBe('false');
    expect(dropboxPanel.getAttribute('aria-hidden')).toBe('true');
    process.env.REACT_APP_DROPBOX_APP_KEY = previousKey;
  });

  it('reveals the Dropbox panel and hides the local panel when the Dropbox chip is clicked', async () => {
    const previousKey = process.env.REACT_APP_DROPBOX_APP_KEY;
    process.env.REACT_APP_DROPBOX_APP_KEY = 'test-key';
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const dropboxChip = within(container).getByRole('button', {
      name: 'Dropbox',
    });
    expect(dropboxChip).toBeTruthy();
    await act(async () => {
      dropboxChip.click();
    });
    const localPanel = container.querySelector('#upload-panel-local')!;
    const dropboxPanel = container.querySelector('#upload-panel-dropbox')!;
    expect(localPanel.getAttribute('aria-hidden')).toBe('true');
    expect(dropboxPanel.getAttribute('aria-hidden')).toBe('false');
    process.env.REACT_APP_DROPBOX_APP_KEY = previousKey;
  });

  it('keeps the same file input mounted across a chip switch round-trip', async () => {
    const previousKey = process.env.REACT_APP_DROPBOX_APP_KEY;
    process.env.REACT_APP_DROPBOX_APP_KEY = 'test-key';
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const before = container.querySelector('input#pakker');
    const dropboxChip = within(container).getByRole('button', {
      name: 'Dropbox',
    });
    await act(async () => {
      dropboxChip.click();
    });
    await act(async () => {
      dropboxChip.click();
    });
    const after = container.querySelector('input#pakker');
    expect(after).toBe(before);
    process.env.REACT_APP_DROPBOX_APP_KEY = previousKey;
  });

  it('shows a "Change source" button inside the Dropbox panel after selecting Dropbox', async () => {
    const previousKey = process.env.REACT_APP_DROPBOX_APP_KEY;
    process.env.REACT_APP_DROPBOX_APP_KEY = 'test-key';
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const dropboxChip = within(container).getByRole('button', {
      name: 'Dropbox',
    });
    await act(async () => {
      dropboxChip.click();
    });
    const changeBtn = container.querySelector(
      'button[aria-label="Change upload source"]'
    );
    expect(changeBtn).not.toBeNull();
    process.env.REACT_APP_DROPBOX_APP_KEY = previousKey;
  });

  it('clicking "Change source" in the Dropbox panel returns to the local panel', async () => {
    const previousKey = process.env.REACT_APP_DROPBOX_APP_KEY;
    process.env.REACT_APP_DROPBOX_APP_KEY = 'test-key';
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const dropboxChip = within(container).getByRole('button', {
      name: 'Dropbox',
    });
    await act(async () => {
      dropboxChip.click();
    });
    const changeBtn = container.querySelector(
      'button[aria-label="Change upload source"]'
    ) as HTMLButtonElement;
    await act(async () => {
      changeBtn.click();
    });
    const localPanel = container.querySelector('#upload-panel-local')!;
    const dropboxPanel = container.querySelector('#upload-panel-dropbox')!;
    expect(localPanel.getAttribute('aria-hidden')).toBe('false');
    expect(dropboxPanel.getAttribute('aria-hidden')).toBe('true');
    process.env.REACT_APP_DROPBOX_APP_KEY = previousKey;
  });

  it('does not fire conversion_success when the deck is empty', async () => {
    const gtag = (globalThis as AnalyticsGlobals).gtag!;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'X-Card-Count': '0',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(gtag).not.toHaveBeenCalledWith('event', 'conversion_success');
  });

  it('shows the inline chat toggle in the error state instead of a deep-link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        text: () => Promise.resolve('Bad request'),
        headers: new Headers({ 'Content-Type': 'text/plain' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      const toggle = container.querySelector(
        'button[aria-controls="error-state-chat-panel"]'
      );
      expect(toggle).not.toBeNull();
      expect(toggle?.textContent).toContain('Talk it through instead');
    });
    expect(container.querySelector('a[href*="/chat?from=upload"]')).toBeNull();
  });

  it('fires upload_error_chat_shown once when the error state mounts', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        text: () => Promise.resolve('Bad request'),
        headers: new Headers({ 'Content-Type': 'text/plain' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(
        container.querySelector(
          'button[aria-controls="error-state-chat-panel"]'
        )
      ).not.toBeNull();
    });

    const chatShownCalls = trackMock.mock.calls.filter(
      ([name]) => name === 'upload_error_chat_shown'
    );
    expect(chatShownCalls).toHaveLength(1);
  });

  it('fires upload_error_chat_engaged on first expand of the inline panel', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        text: () => Promise.resolve('Bad request'),
        headers: new Headers({ 'Content-Type': 'text/plain' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(
        container.querySelector(
          'button[aria-controls="error-state-chat-panel"]'
        )
      ).not.toBeNull();
    });

    const toggle = container.querySelector(
      'button[aria-controls="error-state-chat-panel"]'
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(toggle);
    });
    await act(async () => {
      fireEvent.click(toggle);
    });

    const engagedCalls = trackMock.mock.calls.filter(
      ([name]) => name === 'upload_error_chat_engaged'
    );
    expect(engagedCalls).toHaveLength(1);
  });

  it('shows the inline chat toggle in the empty-deck state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'X-Card-Count': '0',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      const toggle = container.querySelector('button[aria-expanded]');
      expect(toggle).not.toBeNull();
      expect(toggle?.textContent).toContain('Ask Claude about this file');
      expect(toggle?.getAttribute('aria-controls')).toBe(
        'empty-deck-chat-panel'
      );
    });
  });

  it('fires upload_empty_deck_chat_shown once when the empty-deck state mounts', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'X-Card-Count': '0',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(container.querySelector('button[aria-expanded]')).not.toBeNull();
    });

    const shownCalls = trackMock.mock.calls.filter(
      ([name]) => name === 'upload_empty_deck_chat_shown'
    );
    expect(shownCalls).toHaveLength(1);
  });

  it('fires upload_empty_deck_chat_engaged on first expand', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'X-Card-Count': '0',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(container.querySelector('button[aria-expanded]')).not.toBeNull();
    });

    const toggle = container.querySelector(
      'button[aria-expanded]'
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(toggle);
    });
    await act(async () => {
      fireEvent.click(toggle);
    });

    const engagedCalls = trackMock.mock.calls.filter(
      ([name]) => name === 'upload_empty_deck_chat_engaged'
    );
    expect(engagedCalls).toHaveLength(1);

    const panel = container.querySelector('#empty-deck-chat-panel');
    expect(
      panel === null ||
        panel.getAttribute('aria-label')?.startsWith('Ask Claude about')
    ).toBe(true);
  });

  it('shows per-code copy for too_large errors', async () => {
    const jsonBody = { code: 'too_large', message: 'original server message' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(jsonBody) }),
        text: () => Promise.resolve(JSON.stringify(jsonBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      const errorBody = container.querySelector('[class*="errorBody"]');
      expect(errorBody?.textContent).toMatch(/too large/i);
    });
  });

  it('shows per-code copy for unsupported_format errors', async () => {
    const jsonBody = {
      code: 'unsupported_format',
      message: 'original server message',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(jsonBody) }),
        text: () => Promise.resolve(JSON.stringify(jsonBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      const errorBody = container.querySelector('[class*="errorBody"]');
      expect(errorBody?.textContent).toMatch(/file type/i);
    });
  });

  it('hands a finished deck to Print and CSV, and keeps choosing another file as a quiet option', async () => {
    const jsonBody = {
      code: 'unsupported_format',
      message: 'This file is already an Anki deck.',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(jsonBody) }),
        text: () => Promise.resolve(JSON.stringify(jsonBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(container.textContent).toMatch(
        /This is already a finished Anki deck/
      );
    });

    expect(
      screen.getByRole('button', { name: 'Print it as a PDF' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Export it to CSV' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose a different file' })
    ).toBeInTheDocument();
    expect(container.querySelector('a[href="/transform"]')).toBeNull();
  });

  it('takes the same deck file to Print without choosing it again', async () => {
    const jsonBody = {
      code: 'unsupported_format',
      message: 'This file is already an Anki deck.',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(jsonBody) }),
        text: () => Promise.resolve(JSON.stringify(jsonBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })
    );
    let handedOff: unknown = null;
    function PrintProbe() {
      handedOff = (useLocation().state as { handoffFile?: File } | null)
        ?.handoffFile;
      return <p>print page</p>;
    }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/upload']}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/upload"
              element={<UploadForm setErrorMessage={vi.fn()} />}
            />
            <Route path="/print" element={<PrintProbe />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );
    const deck = new File(['zip'], 'Biology.zip', { type: 'application/zip' });
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [deck],
      configurable: true,
    });
    input.removeAttribute('required');
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Print it as a PDF' })
    );

    expect(await screen.findByText('print page')).toBeInTheDocument();
    expect(handedOff).toBe(deck);
    expect(track).toHaveBeenCalledWith('apkg_upload_handoff_clicked', {
      to: 'print',
    });
  });

  it('converts notes handed over from a deck tool straight away', async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const notes = new File(['# notes'], 'notes.zip', {
      type: 'application/zip',
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/upload', state: { handoffFile: notes } },
        ]}
      >
        <QueryClientProvider client={queryClient}>
          <UploadForm setErrorMessage={vi.fn()} />
        </QueryClientProvider>
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/upload/file',
        expect.objectContaining({ method: 'post' })
      )
    );
    const body = fetchMock.mock.calls.find(
      ([url]) => url === '/api/upload/file'
    )?.[1].body as FormData;
    expect((body.get('pakker') as File).name).toBe('notes.zip');
    expect(track).toHaveBeenCalledWith(
      'upload_submitted',
      expect.objectContaining({
        input_format: 'zip',
        trigger: 'handoff',
        retry: false,
      })
    );
  });

  it('clicking the apkg-reject primary action resets the form and opens the file picker', async () => {
    const jsonBody = {
      code: 'unsupported_format',
      message: 'This file is already an Anki deck.',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(jsonBody) }),
        text: () => Promise.resolve(JSON.stringify(jsonBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(container.textContent).toMatch(
        /This is already a finished Anki deck/
      );
    });

    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');

    const primary = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Choose a different file'
    )!;
    let labelLeftAlone = true;
    await act(async () => {
      labelLeftAlone = fireEvent.click(primary);
    });

    expect(clickSpy).toHaveBeenCalled();
    expect(labelLeftAlone).toBe(false);
    await waitFor(() => {
      expect(
        container.textContent?.includes('This is already a finished Anki deck')
      ).toBe(false);
    });
  });

  it('renders empty-deck spec copy with docs link on the 200 + 0-cards path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'X-Card-Count': '0',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      const body = container.querySelector('[class*="emptyBody"]');
      expect(body?.textContent).toContain('No cards were found in this file.');
      expect(body?.textContent).toContain(
        'Most files need a toggle-list (Notion) or a question/answer pair'
      );
      const link = container.querySelector(
        'a[href="/documentation/help/common-problems"]'
      );
      expect(link?.textContent).toBe('common problems');
    });
  });

  it('shows text-file-specific empty copy when a .txt yields 0 cards', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'X-Card-Count': '0',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['just prose'], 'study notes.txt', {
      type: 'text/plain',
    });
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      const body = container.querySelector('[class*="emptyBody"]');
      expect(body?.textContent).toContain('No cards in this file.');
      expect(body?.textContent).toContain('question - answer');
      expect(body?.textContent).toContain('separate the two with a tab');
    });
  });

  it('routes a 400 with code=empty_export into the emptyDeck info card', async () => {
    const jsonBody = {
      code: 'empty_export',
      message:
        'No cards were found in this file. Most files need a toggle-list (Notion) or a question/answer pair to become cards. See common problems for the formats that work.',
      filename: 'notes.zip',
      docsLink: '/documentation/help/common-problems',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(jsonBody) }),
        text: () => Promise.resolve(JSON.stringify(jsonBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      const body = container.querySelector('[class*="emptyBody"]');
      expect(body?.textContent).toContain(
        'Most files need a toggle-list (Notion) or a question/answer pair'
      );
      expect(container.querySelector('[class*="errorBody"]')).toBeNull();
      expect(
        container.querySelector('[class*="emptyDownloadButton"]')
      ).toBeNull();
    });
  });

  it('shows what was read above the empty-deck guidance', async () => {
    const jsonBody = {
      code: 'empty_export',
      message: 'No cards were found in this file.',
      filename: 'notes.html',
      docsLink: '/documentation/help/common-problems',
      empty_reason: 'no_toggles',
      reading: {
        kind: 'document',
        words: 3200,
        headings: 14,
        listItems: 0,
        tables: 0,
        toggles: 0,
        images: 0,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(jsonBody) }),
        text: () => Promise.resolve(JSON.stringify(jsonBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      const reading = container.querySelector('[class*="emptyReading"]');
      expect(reading?.textContent).toBe(
        'We read 3200 words and 14 headings. Nothing in it is shaped like a card: no toggles and no question-and-answer pairs.'
      );
      expect(
        container.querySelector('[class*="emptyBody"]')?.textContent
      ).toContain(
        'Put each question in a toggle with its answer inside it, then convert again. See common problems for the formats that work.'
      );
    });
  });

  it('offers one-click rescue buttons and resubmits the files with the chosen rule', async () => {
    const jsonBody = {
      code: 'empty_export',
      message: 'No cards were found in this file.',
      filename: 'notes.html',
      docsLink: '/documentation/help/common-problems',
      empty_reason: 'no_toggles',
      rescue: [
        {
          rule: 'heading',
          cards: 14,
          sample: [{ front: 'Krebs cycle', back: 'Makes ATP in the matrix.' }],
        },
        { rule: 'bullets', cards: 40 },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      redirected: false,
      status: 400,
      clone: () => ({ json: () => Promise.resolve(jsonBody) }),
      text: () => Promise.resolve(JSON.stringify(jsonBody)),
      headers: new Headers({
        'Content-Type': 'application/json',
        'X-Upload-Owner': 'none',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['<p>prose</p>'], 'notes.html', {
      type: 'text/html',
    });
    Object.defineProperty(input, 'files', { value: [file] });
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    const buttons = await waitFor(() => {
      const found = Array.from(
        container.querySelectorAll('[class*="rescueButton"]')
      );
      expect(found).toHaveLength(2);
      return found as HTMLButtonElement[];
    });
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Make 14 cards from the headings',
      'Make 40 cards from the bullet points',
    ]);
    expect(
      container.querySelector('[class*="emptyBody"]')?.textContent
    ).not.toContain('Put each question');
    const samples = container.querySelectorAll('[class*="rescueSample"] li');
    expect(samples).toHaveLength(1);
    expect(samples[0].textContent).toBe('Krebs cycleMakes ATP in the matrix.');

    await act(async () => {
      buttons[1].click();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const [, retry] = fetchMock.mock.calls[1] as [string, RequestInit];
    const sent = retry.body as FormData;
    expect(sent.get('rescue-rule')).toBe('bullets');
    expect((sent.get('pakker') as File).name).toBe('notes.html');
    expect(track).toHaveBeenCalledWith(
      'upload_submitted',
      expect.objectContaining({ trigger: 'resend', retry: true })
    );
  });

  it('offers no rescue buttons for a multi-file submit', async () => {
    const jsonBody = {
      code: 'empty_export',
      message: 'No cards were found in this file.',
      filename: 'a.html',
      docsLink: '/documentation/help/common-problems',
      empty_reason: 'no_toggles',
      rescue: [{ rule: 'heading', cards: 2 }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(jsonBody) }),
        text: () => Promise.resolve(JSON.stringify(jsonBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [
        new File(['<p>a</p>'], 'a.html', { type: 'text/html' }),
        new File(['<p>b</p>'], 'b.html', { type: 'text/html' }),
      ],
    });
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(container.querySelector('[class*="emptyTitle"]')).not.toBeNull();
    });
    expect(container.querySelector('[class*="rescueButton"]')).toBeNull();
  });

  it('tells a zip-of-photos user to unzip before Photo to Deck', async () => {
    const jsonBody = {
      code: 'image_only_no_text',
      message: 'These look like images with no text to read.',
      filename: 'photos.zip',
      photoToDeckUrl: '/photo-to-deck',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(jsonBody) }),
        text: () => Promise.resolve(JSON.stringify(jsonBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['PK'], 'photos.zip', { type: 'application/zip' })],
    });
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(container.textContent).toContain(
        'Photo to Deck takes the photos themselves, not the zip.'
      );
    });
  });

  it('shows no unzip line for a bare image that has no text', async () => {
    const jsonBody = {
      code: 'image_only_no_text',
      message: 'These look like images with no text to read.',
      filename: 'photo.png',
      photoToDeckUrl: '/photo-to-deck',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(jsonBody) }),
        text: () => Promise.resolve(JSON.stringify(jsonBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['png'], 'photo.png', { type: 'image/png' })],
    });
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(container.textContent).toContain(
        'Photo to Deck turns images into cards'
      );
    });
    expect(container.textContent).not.toContain('not the zip');
  });

  describe('AI offer on the empty state', () => {
    const trackMock = vi.mocked(track);
    afterEach(() => {
      globalThis.localStorage.removeItem('claude-ai-flashcards');
    });
    const emptyBody = {
      code: 'empty_export',
      message: 'No cards were found in this file.',
      filename: 'notes.html',
      docsLink: '/documentation/help/common-problems',
      empty_reason: 'no_toggles',
    };
    const emptyFetch = () =>
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(emptyBody) }),
        text: () => Promise.resolve(JSON.stringify(emptyBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });
    const submitOneFile = async (container: HTMLElement) => {
      const input = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      Object.defineProperty(input, 'files', {
        value: [
          new File(['<p>prose</p>'], 'notes.html', { type: 'text/html' }),
        ],
      });
      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
      });
      await waitFor(() => {
        expect(container.querySelector('[class*="emptyTitle"]')).not.toBeNull();
      });
    };

    it('points an anonymous user at the paid plan and records the offer', async () => {
      vi.stubGlobal('fetch', emptyFetch());
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      await submitOneFile(container);
      const link = container.querySelector('a[href="/pricing"]');
      expect(link?.textContent).toBe('Get AI cards with a paid plan');
      expect(trackMock).toHaveBeenCalledWith('upload_ai_rescue_shown', {
        state: 'anon',
      });
      await act(async () => {
        (link as HTMLAnchorElement).click();
      });
      expect(trackMock).toHaveBeenCalledWith('upload_ai_rescue_clicked', {
        state: 'anon',
      });
    });

    it('points a free account at the paid plan', async () => {
      mockUseUserLocals.mockReturnValue({
        data: { user: { id: 7 }, locals: { subscriber: false } },
        isLoading: false,
        error: null,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useUserLocals>);
      vi.stubGlobal('fetch', emptyFetch());
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      await submitOneFile(container);
      const link = container.querySelector('a[href="/pricing"]');
      expect(link?.textContent).toBe('Get AI cards with a paid plan');
    });

    it('resubmits the file with AI on for a paying account with AI off', async () => {
      const payingAccount = { user: { id: 7 }, locals: { subscriber: true } };
      mockUseUserLocals.mockReturnValue({
        data: payingAccount,
        isLoading: false,
        error: null,
        isError: false,
        refetch: vi.fn().mockResolvedValue({
          data: payingAccount,
          status: 'success',
          isError: false,
        }),
      } as unknown as ReturnType<typeof useUserLocals>);
      globalThis.localStorage.setItem('claude-ai-flashcards', 'false');
      const fetchMock = emptyFetch();
      vi.stubGlobal('fetch', fetchMock);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      await submitOneFile(container);
      const button = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Make cards with AI'
      );
      expect(button).toBeDefined();
      expect(trackMock).toHaveBeenCalledWith('upload_ai_rescue_shown', {
        state: 'paying',
      });
      await act(async () => {
        button!.click();
      });
      expect(trackMock).toHaveBeenCalledWith('upload_ai_rescue_clicked', {
        state: 'paying',
      });
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
      const [, retry] = fetchMock.mock.calls[1] as [string, RequestInit];
      const sent = retry.body as FormData;
      expect(sent.getAll('claude-ai-flashcards')).toEqual(['true']);
      expect((sent.get('pakker') as File).name).toBe('notes.html');
    });

    it('shows no AI button for a paying account that submitted two files', async () => {
      mockUseUserLocals.mockReturnValue({
        data: { user: { id: 7 }, locals: { subscriber: true } },
        isLoading: false,
        error: null,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useUserLocals>);
      vi.stubGlobal('fetch', emptyFetch());
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      const input = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      Object.defineProperty(input, 'files', {
        value: [
          new File(['<p>a</p>'], 'a.html', { type: 'text/html' }),
          new File(['<p>b</p>'], 'b.html', { type: 'text/html' }),
        ],
      });
      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
      });
      await waitFor(() => {
        expect(container.querySelector('[class*="emptyTitle"]')).not.toBeNull();
      });
      expect(container.textContent).not.toContain('Make cards with AI');
    });

    it('offers nothing and counts nothing on the .txt empty state', async () => {
      const txtBody = {
        ...emptyBody,
        filename: 'notes.txt',
        rescue: [{ rule: 'heading', cards: 2 }],
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          redirected: false,
          status: 400,
          clone: () => ({ json: () => Promise.resolve(txtBody) }),
          text: () => Promise.resolve(JSON.stringify(txtBody)),
          headers: new Headers({ 'Content-Type': 'application/json' }),
        })
      );
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      const input = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      Object.defineProperty(input, 'files', {
        value: [new File(['prose'], 'notes.txt', { type: 'text/plain' })],
      });
      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
      });
      await waitFor(() => {
        expect(container.querySelector('[class*="emptyTitle"]')).not.toBeNull();
      });
      expect(container.querySelector('a[href="/pricing"]')).toBeNull();
      expect(trackMock).not.toHaveBeenCalledWith(
        'upload_ai_rescue_shown',
        expect.anything()
      );
      expect(trackMock).not.toHaveBeenCalledWith(
        'upload_rescue_offered',
        expect.anything()
      );
    });

    it('does not offer AI again after the AI resend also made no cards', async () => {
      const payingAccount = { user: { id: 7 }, locals: { subscriber: true } };
      mockUseUserLocals.mockReturnValue({
        data: payingAccount,
        isLoading: false,
        error: null,
        isError: false,
        refetch: vi.fn().mockResolvedValue({
          data: payingAccount,
          status: 'success',
          isError: false,
        }),
      } as unknown as ReturnType<typeof useUserLocals>);
      const fetchMock = emptyFetch();
      vi.stubGlobal('fetch', fetchMock);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      await submitOneFile(container);
      const button = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Make cards with AI'
      );
      await act(async () => {
        button!.click();
      });
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
      await waitFor(() => {
        expect(container.querySelector('[class*="emptyTitle"]')).not.toBeNull();
      });
      expect(container.textContent).not.toContain('Make cards with AI');
      expect(
        trackMock.mock.calls.filter(
          ([name, props]) =>
            name === 'upload_ai_rescue_shown' &&
            (props as { state: string }).state === 'paying'
        )
      ).toHaveLength(1);
    });

    it('shows no AI offer when AI already ran', async () => {
      mockUseUserLocals.mockReturnValue({
        data: { user: { id: 7 }, locals: { subscriber: true } },
        isLoading: false,
        error: null,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useUserLocals>);
      vi.stubGlobal('fetch', emptyFetch());
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn />
      );
      await submitOneFile(container);
      expect(container.textContent).not.toContain('Make cards with AI');
    });
  });

  it('keeps the reading off the card-filter state, where it would contradict the body', async () => {
    const jsonBody = {
      code: 'empty_export',
      message: 'No cards were found in this file.',
      filename: 'notes.html',
      docsLink: '/documentation/help/common-problems',
      empty_reason: 'all_filtered',
      reading: {
        kind: 'document',
        words: 400,
        headings: 0,
        listItems: 0,
        tables: 0,
        toggles: 5,
        images: 0,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(jsonBody) }),
        text: () => Promise.resolve(JSON.stringify(jsonBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(
        container.querySelector('[class*="emptyBody"]')?.textContent
      ).toContain('A card filter removed every card.');
      expect(container.querySelector('[class*="emptyReading"]')).toBeNull();
    });
  });

  const imageOnlyJsonBody = {
    code: 'image_only_no_text',
    message:
      'These look like images — no text to read. Turn them into cards with Photo to Deck.',
    filename: 'lecture-page.png',
    photoToDeckUrl: '/photo-to-deck',
  };

  function stubImageOnlyFetch() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(imageOnlyJsonBody) }),
        text: () => Promise.resolve(JSON.stringify(imageOnlyJsonBody)),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      })
    );
  }

  async function submitImageOnly() {
    const result = renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    const form = result.container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });
    return result;
  }

  it('sends an anonymous image-only upload to a free account, not the sign-in wall', async () => {
    mockUseUserLocals.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
    stubImageOnlyFetch();

    const { container } = await submitImageOnly();

    const cta = await screen.findByRole('link', {
      name: 'Create a free account',
    });
    expect(cta).toHaveAttribute('href', '/register?redirect=/photo-to-deck');
    expect(
      screen.getByText('5 photos a month are free with an account.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Photo to Deck turns images into cards')
    ).toBeInTheDocument();
    expect(container.querySelector('[class*="errorBody"]')).toBeNull();
  });

  it('sends a signed-in image-only upload straight to Photo to Deck', async () => {
    mockUseUserLocals.mockReturnValue({
      data: {
        user: { id: 42 },
        locals: { owner: 42 },
      },
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
    stubImageOnlyFetch();

    await submitImageOnly();

    expect(
      await screen.findByRole('button', { name: 'Open Photo to Deck' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Create a free account')).toBeNull();
    expect(
      screen.queryByText('5 photos a month are free with an account.')
    ).toBeNull();
  });

  it('tags image_only_photo_deck_clicked with the anonymous context', async () => {
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    mockUseUserLocals.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
    stubImageOnlyFetch();

    await submitImageOnly();

    const cta = await screen.findByRole('link', {
      name: 'Create a free account',
    });
    fireEvent.click(cta);

    expect(trackMock).toHaveBeenCalledWith('image_only_photo_deck_shown');
    expect(trackMock).toHaveBeenCalledWith('image_only_photo_deck_clicked', {
      context: 'anonymous',
    });
  });

  it('tags image_only_photo_deck_clicked with the signed-in context', async () => {
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    mockUseUserLocals.mockReturnValue({
      data: {
        user: { id: 42 },
        locals: { owner: 42 },
      },
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
    stubImageOnlyFetch();

    await submitImageOnly();

    const cta = await screen.findByRole('button', {
      name: 'Open Photo to Deck',
    });
    fireEvent.click(cta);

    await waitFor(() =>
      expect(trackMock).toHaveBeenCalledWith('image_only_photo_deck_clicked', {
        context: 'signed_in',
        photos: 0,
      })
    );
  });

  it('hands the photos inside an uploaded zip to Photo to Deck', async () => {
    mockUseUserLocals.mockReturnValue({
      data: { user: { id: 42 }, locals: { owner: 42 } },
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
    stubImageOnlyFetch();
    const { zipSync } = await import('fflate');
    const zip = new File(
      [
        zipSync({
          'slides/02.png': new TextEncoder().encode('two'),
          'slides/01.png': new TextEncoder().encode('one'),
        }),
      ],
      'slides.zip',
      { type: 'application/zip' }
    );
    function PhotoProbe() {
      const location = useLocation();
      const photos = (location.state as { handoffPhotos?: File[] } | null)
        ?.handoffPhotos;
      return <p>handed: {(photos ?? []).map((p) => p.name).join(',')}</p>;
    }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/upload']}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/upload"
              element={<UploadForm setErrorMessage={vi.fn()} />}
            />
            <Route path="/photo-to-deck" element={<PhotoProbe />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [zip], configurable: true });
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Photo to Deck' })
    );

    expect(
      await screen.findByText('handed: 01.png,02.png')
    ).toBeInTheDocument();
  });

  it('shows the Photo to Deck state for an iPhone HEIC photo without uploading it', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        requests.push(url);
        return Promise.resolve(new Response('{}'));
      })
    );
    sessionStorage.setItem('upload_pending_filename', 'older.pdf');
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['h'], 'IMG_0001.HEIC', { type: 'image/heic' })],
      configurable: true,
    });
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
    });

    expect(
      await screen.findByText('Photo to Deck turns images into cards')
    ).toBeInTheDocument();
    expect(requests).not.toContain('/api/upload/file');
    expect(sessionStorage.getItem('upload_pending_filename')).toBeNull();
  });

  it('tracks upload_failed with reason=network when fetch throws a TypeError', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      const calls = trackMock.mock.calls.filter(
        ([name]) => name === 'upload_failed'
      );
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toMatchObject({ reason: 'network' });
    });
  });

  describe('upload failure reporting', () => {
    function stubFetch(uploadError: Error) {
      const reports: Array<Record<string, unknown>> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init?: RequestInit) => {
          if (url === '/api/events/errors') {
            reports.push(JSON.parse(init?.body as string));
            return Promise.resolve(new Response(null));
          }
          return Promise.reject(uploadError);
        })
      );
      return reports;
    }

    async function submitUpload(file?: File) {
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      if (file != null) {
        const fileInput = container.querySelector(
          'input[type="file"]'
        ) as HTMLInputElement;
        Object.defineProperty(fileInput, 'files', {
          value: [file],
          configurable: true,
        });
      }
      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
      });
    }

    it('keeps a network failure out of the ops error log and records its elapsed seconds', async () => {
      const { track } = await import('../../../../lib/analytics/track');
      const trackMock = vi.mocked(track);
      trackMock.mockClear();
      const reports = stubFetch(new TypeError('Failed to fetch'));
      const file = new File(['x'], 'Study Notes.PDF');

      await submitUpload(file);

      await waitFor(() =>
        expect(trackMock).toHaveBeenCalledWith(
          'upload_failed',
          expect.objectContaining({
            reason: 'network',
            fileExt: '.pdf',
            elapsedSeconds: expect.any(Number),
          })
        )
      );
      expect(reports).toEqual([]);
    });

    it('asks for a fresh pick when the first byte reads but the rest of the file does not, without uploading', async () => {
      const { track } = await import('../../../../lib/analytics/track');
      const trackMock = vi.mocked(track);
      trackMock.mockClear();
      const requests: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          requests.push(url);
          return Promise.resolve(new Response(null));
        })
      );
      const file = new File(['xyz'], 'cloud.pdf');
      Object.defineProperty(file, 'arrayBuffer', {
        value: () =>
          Promise.reject(new DOMException('partial', 'NotReadableError')),
      });

      await submitUpload(file);

      await waitFor(() =>
        expect(
          screen.getByText("We couldn't read this file")
        ).toBeInTheDocument()
      );
      expect(requests).not.toContain('/api/upload/file');
      expect(trackMock).toHaveBeenCalledWith(
        'upload_file_unreadable',
        expect.objectContaining({ reason: 'partial', fileExt: '.pdf' })
      );
    });

    it('asks for a fresh pick when the browser can no longer read the file, without uploading', async () => {
      const { track } = await import('../../../../lib/analytics/track');
      const trackMock = vi.mocked(track);
      trackMock.mockClear();
      const requests: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          requests.push(url);
          return Promise.resolve(new Response(null));
        })
      );
      const file = new File(['x'], 'notes.zip');
      Object.defineProperty(file, 'slice', {
        value: () => ({
          arrayBuffer: () =>
            Promise.reject(new DOMException('changed', 'NotReadableError')),
        }),
      });

      await submitUpload(file);

      await waitFor(() =>
        expect(
          screen.getByText("We couldn't read this file")
        ).toBeInTheDocument()
      );
      expect(
        screen.getByRole('button', { name: 'Choose the file again' })
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(requests).not.toContain('/api/upload/file');
      expect(requests).not.toContain('/api/events/errors');
      expect(trackMock).toHaveBeenCalledWith(
        'upload_file_unreadable',
        expect.objectContaining({ reason: 'changed', fileExt: '.zip' })
      );
      expect(trackMock).not.toHaveBeenCalledWith(
        'upload_failed',
        expect.anything()
      );
    });

    it('names a 0-byte pick as empty and asks for the downloaded copy, without uploading', async () => {
      const { track } = await import('../../../../lib/analytics/track');
      const trackMock = vi.mocked(track);
      trackMock.mockClear();
      const requests: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          requests.push(url);
          return Promise.resolve(new Response(null));
        })
      );

      await submitUpload(new File([], 'placeholder.pdf'));

      await waitFor(() =>
        expect(screen.getByText('This file is empty')).toBeInTheDocument()
      );
      expect(
        screen.getByText(/open it once so it downloads to your computer/)
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Choose the file again' })
      ).toBeInTheDocument();
      expect(requests).not.toContain('/api/upload/file');
      expect(trackMock).toHaveBeenCalledWith(
        'upload_file_unreadable',
        expect.objectContaining({
          reason: 'empty',
          fileExt: '.pdf',
          fileSizeBytes: 0,
        })
      );
      expect(trackMock).not.toHaveBeenCalledWith(
        'upload_failed',
        expect.anything()
      );
    });

    it('does not report a non-network upload error', async () => {
      const { track } = await import('../../../../lib/analytics/track');
      const trackMock = vi.mocked(track);
      trackMock.mockClear();
      const reports = stubFetch(new Error('Unexpected server error'));

      await submitUpload();

      await waitFor(() =>
        expect(trackMock).toHaveBeenCalledWith(
          'upload_failed',
          expect.objectContaining({ reason: 'other' })
        )
      );
      expect(reports).toEqual([]);
    });
  });

  it('tracks upload_failed with reason=other when fetch throws a non-network Error', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Unexpected server error'))
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      const calls = trackMock.mock.calls.filter(
        ([name]) => name === 'upload_failed'
      );
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toMatchObject({ reason: 'other' });
    });
  });

  it('fires upload_error_chat_resolved_retry when chat was engaged and a subsequent conversion succeeds', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    const failResponse = {
      redirected: false,
      status: 400,
      clone: () => ({ json: () => Promise.reject(new Error('not json')) }),
      text: () => Promise.resolve('Bad request'),
      headers: new Headers({ 'Content-Type': 'text/plain' }),
    };
    const successResponse = {
      redirected: false,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="deck.apkg"',
        'X-Card-Count': '5',
      }),
      blob: () => Promise.resolve(new Blob(['fake'])),
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failResponse)
      .mockResolvedValue(successResponse);
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;

    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(
        container.querySelector(
          'button[aria-controls="error-state-chat-panel"]'
        )
      ).not.toBeNull();
    });

    const toggle = container.querySelector(
      'button[aria-controls="error-state-chat-panel"]'
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(toggle);
    });

    trackMock.mockClear();

    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      const calls = trackMock.mock.calls.filter(
        ([name]) => name === 'upload_error_chat_resolved_retry'
      );
      expect(calls).toHaveLength(1);
    });
  });

  it('does not fire upload_error_chat_resolved_retry when error chat was never engaged', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="deck.apkg"',
          'X-Card-Count': '5',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText('No empty backs, no stray characters. Ready for Anki.')
      ).toBeInTheDocument();
    });

    const calls = trackMock.mock.calls.filter(
      ([name]) => name === 'upload_error_chat_resolved_retry'
    );
    expect(calls).toHaveLength(0);
  });

  it('fires make_another_deck_clicked when the success-state button is clicked', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    const gtag = (globalThis as AnalyticsGlobals).gtag!;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="deck.apkg"',
          'X-Card-Count': '5',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    const button = await screen.findByRole('button', {
      name: 'Make another deck',
    });
    expect(button.className).toMatch(/btnSecondary/);

    trackMock.mockClear();
    await act(async () => {
      fireEvent.click(button);
    });

    expect(gtag).toHaveBeenCalledWith('event', 'make_another_deck_clicked');
    const clickedCalls = trackMock.mock.calls.filter(
      ([name]) => name === 'make_another_deck_clicked'
    );
    expect(clickedCalls).toHaveLength(1);
  });

  it('suppresses the uploaded filename in success copy from Hotjar recordings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'File-Name': encodeURIComponent('private-notes.apkg'),
          'X-Card-Count': '5',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    const form = document.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    const successCopy = await screen.findByText(
      'private-notes.apkg was saved to your downloads'
    );
    expect(successCopy).toHaveAttribute('data-hj-suppress');
  });

  it('recovers a dropped download from the server copy when the response carries a key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'File-Name': encodeURIComponent('private-notes.apkg'),
          'X-Card-Count': '5',
          'X-Download-Key': 'owner-1-123-req.apkg',
        }),
        blob: () => Promise.reject(new TypeError('Load failed')),
      })
    );
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    const form = document.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(
      await screen.findByText(
        "Your download didn't finish — the deck is saved to My decks."
      )
    ).toBeInTheDocument();
    const download = screen.getByRole('link', { name: 'Download deck' });
    expect(download).toHaveAttribute(
      'href',
      '/api/download/u/owner-1-123-req.apkg'
    );
    expect(screen.queryByText(/was saved to your downloads/)).toBeNull();
    expect(trackMock).toHaveBeenCalledWith(
      'upload_failed',
      expect.objectContaining({ reason: 'network', recovered: true })
    );
  });

  it('still fails the upload when the body read fails without a download key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'File-Name': encodeURIComponent('private-notes.apkg'),
          'X-Card-Count': '5',
        }),
        blob: () => Promise.reject(new TypeError('Load failed')),
      })
    );
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    const form = document.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(screen.queryByRole('link', { name: 'Download deck' })).toBeNull();
    expect(trackMock).toHaveBeenCalledWith(
      'upload_failed',
      expect.objectContaining({ reason: 'network' })
    );
    expect(trackMock).not.toHaveBeenCalledWith(
      'upload_failed',
      expect.objectContaining({ recovered: true })
    );
  });
});

describe('UploadForm multi-deck batch', () => {
  beforeEach(() => {
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    (globalThis as AnalyticsGlobals).hj = vi.fn();
  });

  afterEach(() => {
    delete (globalThis as AnalyticsGlobals).gtag;
    delete (globalThis as AnalyticsGlobals).hj;
    vi.restoreAllMocks();
  });

  const batchBody = {
    kind: 'batch',
    workspaceId: 'ws-1',
    deckCount: 2,
    decks: [
      {
        name: 'Biology 101',
        filename: 'Biology 101.apkg',
        downloadUrl: '/download/ws-1/Biology%20101.apkg',
      },
      {
        name: 'Chemistry',
        filename: 'Chemistry.apkg',
        downloadUrl: '/download/ws-1/Chemistry.apkg',
      },
    ],
    bulkUrl: '/download/ws-1/bulk',
  };

  function stubBatchFetch() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve(batchBody),
      })
    );
  }

  it('renders an in-page deck list instead of navigating away on a multi-deck batch', async () => {
    const locationStub = { href: '', origin: 'http://localhost' } as Location;
    vi.stubGlobal('location', locationStub);
    stubBatchFetch();

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await screen.findAllByText('2 decks ready');
    expect(locationStub.href).toBe('');

    const biology = screen.getByLabelText(
      'Download Biology 101'
    ) as HTMLAnchorElement;
    const chemistry = screen.getByLabelText(
      'Download Chemistry'
    ) as HTMLAnchorElement;
    expect(biology.getAttribute('href')).toBe(
      '/download/ws-1/Biology%20101.apkg'
    );
    expect(chemistry.getAttribute('href')).toBe(
      '/download/ws-1/Chemistry.apkg'
    );

    const downloadAll = screen.getByText(
      'Download all (zip)'
    ) as HTMLAnchorElement;
    expect(downloadAll.getAttribute('href')).toBe('/download/ws-1/bulk');
  });

  it('suppresses deck names in the batch list from Hotjar recordings', async () => {
    stubBatchFetch();
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    const deckName = await screen.findByText('Biology 101');
    expect(deckName).toHaveAttribute('data-hj-suppress');
  });
});

describe('signed-out card-cap hint on the idle drop zone', () => {
  beforeEach(() => {
    mockUseCardUsage.mockReturnValue(null);
    mockGet2ankiApi.mockReturnValue({
      getHeldDeck: vi.fn().mockResolvedValue(null),
      getUploads: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof get2ankiApi>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setLocals(data: ReturnType<typeof useUserLocals>['data']) {
    mockUseUserLocals.mockReturnValue({
      data,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    });
  }

  const capHint =
    'Without an account, you get up to 21 cards per conversion. A free account unlocks 100 cards a month.';

  it('tells a signed-out visitor the per-conversion cap and the free monthly allowance', () => {
    setLocals({
      user: null,
      locals: {},
    } as unknown as ReturnType<typeof useUserLocals>['data']);
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    expect(screen.getByText(capHint)).toBeInTheDocument();
  });

  it('hides the cap hint once the visitor is signed in', () => {
    setLocals({
      user: { id: 7 },
      locals: {},
    } as unknown as ReturnType<typeof useUserLocals>['data']);
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    expect(
      screen.queryByText(/you get up to 21 cards per conversion/)
    ).not.toBeInTheDocument();
  });

  function setLocalsLoading() {
    mockUseUserLocals.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      isError: false,
      refetch: vi.fn(),
    });
  }

  it('shows the cap hint while the session loads for a visitor with no session', () => {
    setLocalsLoading();
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    expect(screen.getByText(capHint)).toBeInTheDocument();
  });

  it('keeps the cap hint out while the session loads on a page marked signed in', () => {
    setLocalsLoading();
    document.documentElement.dataset.auth = '1';
    try {
      renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
      expect(
        screen.queryByText(/you get up to 21 cards per conversion/)
      ).not.toBeInTheDocument();
    } finally {
      delete document.documentElement.dataset.auth;
    }
  });
});

describe('held-deck gate screen-reader announcement', () => {
  const anonymousLocals = {
    user: null,
    locals: {},
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  beforeEach(() => {
    vi.unstubAllGlobals();
    mockUseCardUsage.mockReturnValue(null);
    mockUseUserLocals.mockReturnValue({
      data: anonymousLocals,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubHeldFetch(held: {
    cardCount: number;
    cardsHeldBack: number;
    totalCards: number;
  }) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ kind: 'held', ...held }),
      })
    );
  }

  async function submitHeld(held: {
    cardCount: number;
    cardsHeldBack: number;
    totalCards: number;
  }) {
    stubHeldFetch(held);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });
    return container;
  }

  it('announces the whole file when it fits a free month', async () => {
    const container = await submitHeld({
      cardCount: 21,
      cardsHeldBack: 13,
      totalCards: 34,
    });
    await waitFor(() => {
      const live = container.querySelector('output[aria-live="polite"]');
      expect(live?.textContent).toBe(
        'All 34 cards are ready. Create a free account to download them.'
      );
    });
  });

  it('announces the first 100 when the file is over a free month', async () => {
    const container = await submitHeld({
      cardCount: 21,
      cardsHeldBack: 100,
      totalCards: 121,
    });
    await waitFor(() => {
      const live = container.querySelector('output[aria-live="polite"]');
      expect(live?.textContent).toBe(
        'Your first 100 cards are ready. Create a free account to download them.'
      );
    });
  });

  it('shows the pass-first gate and announces the preview, not the free month, when the flag is on', async () => {
    mockUseUserLocals.mockReturnValue({
      data: {
        ...anonymousLocals,
        features: { kiUI: false, limitWallPassFirst: true },
      },
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
    const container = await submitHeld({
      cardCount: 21,
      cardsHeldBack: 163,
      totalCards: 184,
    });
    await waitFor(() => {
      const live = container.querySelector('output[aria-live="polite"]');
      expect(live?.textContent).toBe(
        '184 cards ready. Get a pass, then drop the file again for all of them. A free account gets the first 21.'
      );
    });
    expect(
      screen.getByRole('button', { name: /Semester Pass/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'Create a free account for the first 21 cards',
      })
    ).toBeInTheDocument();
    expect(screen.queryByText(/first 100 cards/)).not.toBeInTheDocument();
  });
});

describe('limit state', () => {
  beforeEach(() => {
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
    } as unknown as ReturnType<typeof get2ankiApi>);
    mockUseCardUsage.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const loggedInData = {
    user: { id: 1 },
    locals: {
      owner: 1,
      patreon: false,
      subscriber: false,
      subscriptionInfo: { active: false, email: '', linked_email: '' },
    },
    linked_email: '',
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  const anonymousData = {
    user: null,
    locals: {
      owner: 0,
      patreon: false,
      subscriber: false,
      subscriptionInfo: { active: false, email: '', linked_email: '' },
    },
    linked_email: '',
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  // The kind is the redirect's query after `kind=`, so a test can append
  // `&cards=N` the way the server does.
  function stubLimitFetch(kind: string = 'file_size') {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: true,
        url: `http://localhost/limit?kind=${kind}`,
        status: 200,
        headers: new Headers({}),
        blob: () => Promise.resolve(new Blob([])),
      })
    );
  }

  function setUserLocals(data: ReturnType<typeof useUserLocals>['data']) {
    mockUseUserLocals.mockReturnValue({
      data,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    });
  }

  async function submitAndReachLimit() {
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });
    await waitFor(() => {
      expect(container.querySelector('[class*="limitContent"]')).not.toBeNull();
    });
    return container;
  }

  it('pre-emptively locks the upload form when a free user is over the monthly limit', () => {
    setUserLocals(loggedInData);
    mockUseCardUsage.mockReturnValue({
      cards_used: 100,
      cards_limit: 100,
      unlimited: false,
      loading: false,
    });
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    expect(
      screen.getByText("You've used all 100 cards this month")
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Get Day Pass/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plans' })).toBeInTheDocument();
    const fileInput = container.querySelector(
      '#pakker'
    ) as HTMLInputElement | null;
    expect(fileInput?.disabled).toBe(true);
    expect(screen.queryByText('Choose files')).not.toBeInTheDocument();
  });

  it('leads the locked wall with the Semester Pass when the pass-first flag is on', () => {
    setUserLocals({
      ...loggedInData,
      features: { kiUI: false, limitWallPassFirst: true },
    } as ReturnType<typeof useUserLocals>['data']);
    mockUseCardUsage.mockReturnValue({
      cards_used: 100,
      cards_limit: 100,
      unlimited: false,
      loading: false,
    });
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    const semester = screen.getByRole('button', { name: /Semester Pass/ });
    const day = screen.getByRole('button', { name: /Day Pass/ });
    const plans = screen.getByRole('link', { name: 'See plans' });
    expect(
      semester.compareDocumentPosition(day) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      day.compareDocumentPosition(plans) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /Get Day Pass/ })
    ).not.toBeInTheDocument();
  });

  it('does not lock the form when the free user is under the limit', () => {
    setUserLocals(loggedInData);
    mockUseCardUsage.mockReturnValue({
      cards_used: 10,
      cards_limit: 100,
      unlimited: false,
      loading: false,
    });
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    expect(
      screen.queryByText("You've used all 100 cards this month")
    ).not.toBeInTheDocument();
  });

  it('shows a single "Create a free account" CTA for anonymous users with no start_trial param', async () => {
    setUserLocals(anonymousData);
    stubLimitFetch('file_size');
    const container = await submitAndReachLimit();

    const registerLink = container.querySelector('a[href*="register"]');
    expect(registerLink).not.toBeNull();
    expect(registerLink?.textContent).toContain('Create a free account');
    expect(registerLink?.getAttribute('href')).not.toContain('start_trial');

    const dayPassBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Day Pass')
    );
    expect(dayPassBtn).toBeUndefined();
  });

  it('shows the account offer instead of the downloads line on an anonymous success', async () => {
    setUserLocals(anonymousData);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="deck.apkg"',
          'X-Card-Count': '5',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(
      await screen.findByText('This deck lives only on this device')
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/was saved to your downloads/)
    ).not.toBeInTheDocument();
  });

  it('shows upgrade options and a Day Pass shortcut for a logged-in over-limit user', async () => {
    setUserLocals(loggedInData);
    stubLimitFetch('card_count');
    const container = await submitAndReachLimit();

    const upgradeLink = container.querySelector(
      'a[href*="/limit?ref=upload-limit-wall"]'
    );
    expect(upgradeLink).not.toBeNull();
    expect(upgradeLink?.textContent).toContain('See plans');

    const dayPassBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Day Pass')
    );
    expect(dayPassBtn).toBeDefined();
  });

  it('starts a Day Pass checkout and redirects on a url response', async () => {
    setUserLocals(loggedInData);
    const startPassCheckout = vi
      .fn()
      .mockResolvedValue({ url: 'https://checkout.stripe.com/pass' });
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout,
    } as unknown as ReturnType<typeof get2ankiApi>);
    const locationStub = { href: '', origin: 'http://localhost' } as Location;
    vi.stubGlobal('location', locationStub);
    stubLimitFetch('card_count');

    const container = await submitAndReachLimit();
    const dayPassBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Day Pass')
    ) as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(dayPassBtn);
    });

    await waitFor(() => {
      expect(startPassCheckout).toHaveBeenCalledWith(
        '24h',
        undefined,
        'upload-limit-wall'
      );
      expect(locationStub.href).toBe('https://checkout.stripe.com/pass');
    });
  });

  it('shows an error and preserves the form when Day Pass checkout fails', async () => {
    setUserLocals(loggedInData);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
    } as unknown as ReturnType<typeof get2ankiApi>);
    stubLimitFetch('card_count');

    const container = await submitAndReachLimit();
    const dayPassBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Day Pass')
    ) as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(dayPassBtn);
    });

    await waitFor(() => {
      const errorEl = container.querySelector('[role="alert"]');
      expect(errorEl?.textContent).toMatch(/couldn't start checkout/i);
    });
    expect(container.querySelector('[class*="limitContent"]')).not.toBeNull();
  });

  it('uses the file_size title when kind=file_size', async () => {
    setUserLocals(loggedInData);
    stubLimitFetch('file_size');
    const container = await submitAndReachLimit();
    const title = container.querySelector('[class*="limitTitle"]');
    expect(title?.textContent).toMatch(/100 MB/i);
  });

  it('says all 100 cards used when usage is at the cap', async () => {
    setUserLocals(loggedInData);
    mockUseCardUsage.mockReturnValue({
      cards_used: 100,
      cards_limit: 100,
      unlimited: false,
      loading: false,
    });
    stubLimitFetch('card_count');
    const container = await submitAndReachLimit();
    const title = container.querySelector('[class*="limitTitle"]');
    expect(title?.textContent).toMatch(/used all 100 cards this month/i);
  });

  it('says over the free limit when usage is below the cap but the file exceeds it', async () => {
    setUserLocals(loggedInData);
    mockUseCardUsage.mockReturnValue({
      cards_used: 0,
      cards_limit: 100,
      unlimited: false,
      loading: false,
    });
    stubLimitFetch('card_count');
    const container = await submitAndReachLimit();
    const title = container.querySelector('[class*="limitTitle"]');
    expect(title?.textContent).toMatch(
      /over your free limit of 100 cards a month/i
    );
  });

  it('leads the over-the-limit wall with the Semester Pass when the pass-first flag is on', async () => {
    setUserLocals({
      ...loggedInData,
      features: { kiUI: false, limitWallPassFirst: true },
    } as ReturnType<typeof useUserLocals>['data']);
    mockUseCardUsage.mockReturnValue({
      cards_used: 0,
      cards_limit: 100,
      unlimited: false,
      loading: false,
    });
    stubLimitFetch('card_count');
    await submitAndReachLimit();
    const semester = screen.getByRole('button', { name: /Semester Pass/ });
    const day = screen.getByRole('button', { name: /Day Pass/ });
    expect(
      semester.compareDocumentPosition(day) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See plans' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Get Day Pass/ })
    ).not.toBeInTheDocument();
  });

  it('leads a signed-out card limit wall (stale session) with the passes and keeps sign-up as text links', async () => {
    setUserLocals({
      ...anonymousData,
      features: { kiUI: false, limitWallPassFirst: true },
    } as ReturnType<typeof useUserLocals>['data']);
    stubLimitFetch('card_count');
    await submitAndReachLimit();
    const semester = screen.getByRole('button', { name: /Semester Pass/ });
    const signUp = screen.getByRole('link', { name: 'Create a free account' });
    const signIn = screen.getByRole('link', { name: 'Sign in' });
    expect(
      semester.compareDocumentPosition(signUp) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(signUp).toHaveAttribute('href', '/register?redirect=/upload');
    expect(signIn).toHaveAttribute('href', '/login?redirect=/upload');
    fireEvent.click(signIn);
    expect(track).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'upload-limit-wall',
      plan: 'sign_in',
    });
  });

  it('keeps the file-size wall unchanged when the pass-first flag is on', async () => {
    setUserLocals({
      ...anonymousData,
      features: { kiUI: false, limitWallPassFirst: true },
    } as ReturnType<typeof useUserLocals>['data']);
    stubLimitFetch('file_size');
    const container = await submitAndReachLimit();
    expect(
      container.querySelector('a[href*="register"]')?.textContent
    ).toContain('Create a free account');
    expect(
      screen.queryByRole('button', { name: /Semester Pass/ })
    ).not.toBeInTheDocument();
  });

  it('navigates to /limit?kind=anonymous on an anonymous limit redirect', async () => {
    setUserLocals(anonymousData);
    const locationStub = { href: '', origin: 'http://localhost' } as Location;
    vi.stubGlobal('location', locationStub);
    stubLimitFetch('anonymous' as 'file_size');

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(locationStub.href).toBe('/limit?kind=anonymous');
    });
    expect(container.querySelector('[class*="limitContent"]')).toBeNull();
  });

  it('keeps the card count on the anonymous limit redirect when the pass-first flag is on', async () => {
    setUserLocals({
      ...anonymousData,
      features: { kiUI: false, limitWallPassFirst: true },
    } as ReturnType<typeof useUserLocals>['data']);
    const locationStub = { href: '', origin: 'http://localhost' } as Location;
    vi.stubGlobal('location', locationStub);
    stubLimitFetch('anonymous&cards=184');

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      expect(locationStub.href).toBe('/limit?kind=anonymous&cards=184');
    });
  });

  it('decodes a URL-encoded filename for display', async () => {
    setUserLocals(loggedInData);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: true,
        url: 'http://localhost/limit?kind=card_count',
        status: 200,
        headers: new Headers({}),
        blob: () => Promise.resolve(new Blob([])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['x'], 'notes%2Fchapter.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() => {
      const filename = container.querySelector('[class*="limitFilename"]');
      expect(filename?.textContent).toContain('notes/chapter.pdf');
    });
  });

  describe('Notion Markdown guardrail', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function selectMarkdownFile(container: HTMLElement) {
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      const file = new File(['# notes'], 'notes.md', {
        type: 'text/markdown',
      });
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        configurable: true,
      });
      return fileInput;
    }

    function setInputFile(fileInput: HTMLInputElement, file: File) {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        configurable: true,
      });
    }

    function pendingFetch() {
      return vi.fn().mockImplementation(() => new Promise(() => {}));
    }

    it('shows the guardrail and fires upload_guardrail_shown', async () => {
      const trackMock = vi.mocked(track);
      trackMock.mockClear();
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      const fileInput = selectMarkdownFile(container);
      await act(async () => {
        fireEvent.change(fileInput);
      });
      await waitFor(() => {
        const title = container.querySelector('[class*="validationTitle"]');
        expect(title?.textContent).toBe('Notion Markdown drops your toggles');
      });
      expect(trackMock).toHaveBeenCalledWith('upload_guardrail_shown', {
        kind: 'markdown',
      });
    });

    it('announces the guardrail title in the polite live region', async () => {
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      const fileInput = selectMarkdownFile(container);
      await act(async () => {
        fireEvent.change(fileInput);
      });
      await waitFor(() => {
        const live = container.querySelector('output[aria-live="polite"]');
        expect(live?.textContent).toContain(
          'Notion Markdown drops your toggles'
        );
      });
    });

    it('fires upload_guardrail_overridden and submits on Convert anyway', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'X-Card-Count': '3',
        }),
        blob: () => Promise.resolve(new Blob(['deck'])),
      });
      vi.stubGlobal('fetch', fetchMock);
      const trackMock = vi.mocked(track);
      trackMock.mockClear();
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      const fileInput = selectMarkdownFile(container);
      fileInput.removeAttribute('required');
      await act(async () => {
        fireEvent.change(fileInput);
      });
      const button = await screen.findByText('Convert anyway');
      await act(async () => {
        fireEvent.click(button);
      });
      expect(trackMock).toHaveBeenCalledWith('upload_guardrail_overridden', {
        kind: 'markdown',
      });
      await waitFor(() => {
        const uploadCalls = fetchMock.mock.calls.filter(
          ([url]) => url === '/api/upload/file'
        );
        expect(uploadCalls).toHaveLength(1);
      });
    });

    it('does not submit again when a file is picked mid-conversion', async () => {
      const fetchMock = pendingFetch();
      vi.stubGlobal('fetch', fetchMock);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      fileInput.removeAttribute('required');
      setInputFile(fileInput, new File(['deck'], 'first.docx'));
      fireEvent.change(fileInput);
      await act(async () => {});
      setInputFile(fileInput, new File(['deck'], 'second.docx'));
      fireEvent.change(fileInput);
      await act(async () => {});
      const uploadCalls = fetchMock.mock.calls.filter(
        ([url]) => url === '/api/upload/file'
      );
      expect(uploadCalls).toHaveLength(1);
    });

    it('does not fire upload_guardrail_shown while a conversion is in flight', async () => {
      const fetchMock = pendingFetch();
      vi.stubGlobal('fetch', fetchMock);
      const trackMock = vi.mocked(track);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      fileInput.removeAttribute('required');
      setInputFile(fileInput, new File(['deck'], 'first.docx'));
      fireEvent.change(fileInput);
      await act(async () => {});
      trackMock.mockClear();
      setInputFile(
        fileInput,
        new File(['# notes'], 'notes.md', { type: 'text/markdown' })
      );
      fireEvent.change(fileInput);
      await act(async () => {});
      const impressions = trackMock.mock.calls.filter(
        ([event]) => event === 'upload_guardrail_shown'
      );
      expect(impressions).toEqual([]);
    });
  });
});

describe('UploadForm network-failure retry', () => {
  beforeEach(() => {
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    showSignedOutVisitor();
  });

  afterEach(() => {
    delete (globalThis as AnalyticsGlobals).gtag;
    delete (globalThis as AnalyticsGlobals).hj;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockUseUserLocals.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
  });

  // The account read answered for a signed-out visitor, so a dropped upload
  // still has a known sender to try again as.
  function showSignedOutVisitor() {
    const signedOutVisitor = { user: null, locals: {} };
    mockUseUserLocals.mockReturnValue({
      data: signedOutVisitor,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn().mockResolvedValue({
        data: signedOutVisitor,
        status: 'success',
        isError: false,
      }),
    } as unknown as ReturnType<typeof useUserLocals>);
  }

  function successResponse() {
    return {
      redirected: false,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="deck.apkg"',
        'X-Card-Count': '5',
      }),
      blob: () => Promise.resolve(new Blob(['fake'])),
    };
  }

  function selectFile(container: HTMLElement, name: string, sizeBytes: number) {
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['x'], name, { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: sizeBytes });
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });
    fileInput.removeAttribute('required');
    return fileInput;
  }

  async function submitForm(container: HTMLElement) {
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });
  }

  const SMALL = 2 * 1024 * 1024;
  const LARGE = 20 * 1024 * 1024;

  it('keeps the file selected on a network failure and re-submits it on Try again without a new pick', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const fileInput = selectFile(container, 'big.pdf', SMALL);

    await submitForm(container);

    const retry = await screen.findByRole('button', { name: 'Try again' });

    Object.defineProperty(fileInput, 'files', {
      value: [],
      configurable: true,
    });

    fireEvent.click(retry);

    await waitFor(() => {
      const uploadCalls = fetchMock.mock.calls.filter(
        ([url]) => url === '/api/upload/file'
      );
      expect(uploadCalls).toHaveLength(2);
    });
    const retryCall = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/upload/file'
    )[1];
    const body = retryCall[1].body as FormData;
    expect((body.get('pakker') as File).name).toBe('big.pdf');
    expect(track).toHaveBeenCalledWith(
      'upload_submitted',
      expect.objectContaining({
        input_format: 'pdf',
        trigger: 'retry',
        retry: true,
      })
    );

    expect(
      await screen.findByText(
        'No empty backs, no stray characters. Ready for Anki.'
      )
    ).toBeInTheDocument();
  });

  it('sends the page range on the first upload, clears localStorage, and reuses it on Try again', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);
    globalThis.localStorage.setItem('pdf-page-range', '2-4');

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'big.pdf', SMALL);
    await submitForm(container);

    const firstBody = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/upload/file'
    )[0][1].body as FormData;
    expect(firstBody.get('pdf-page-range')).toBe('2-4');
    expect(globalThis.localStorage.getItem('pdf-page-range')).toBeNull();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    fireEvent.click(retry);

    await waitFor(() => {
      const uploadCalls = fetchMock.mock.calls.filter(
        ([url]) => url === '/api/upload/file'
      );
      expect(uploadCalls).toHaveLength(2);
    });
    const retryBody = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/upload/file'
    )[1][1].body as FormData;
    expect(retryBody.get('pdf-page-range')).toBe('2-4');
  });

  it('keeps AI off on Try again for a signed-out visitor with a leftover key', async () => {
    globalThis.localStorage.removeItem('2anki_pass_token');
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      selectFile(container, 'notes.pdf', SMALL);
      await submitForm(container);

      const retry = await screen.findByRole('button', { name: 'Try again' });
      fireEvent.click(retry);

      await waitFor(() => {
        const uploadCalls = fetchMock.mock.calls.filter(
          ([url]) => url === '/api/upload/file'
        );
        expect(uploadCalls).toHaveLength(2);
      });
      const retryBody = fetchMock.mock.calls.filter(
        ([url]) => url === '/api/upload/file'
      )[1][1].body as FormData;
      expect(retryBody.get('claude-ai-flashcards')).toBe('false');
    } finally {
      globalThis.localStorage.removeItem('claude-ai-flashcards');
    }
  });

  it('shows big-file copy when the failed upload is 10 MB or larger', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'lectures.zip', LARGE);

    await submitForm(container);

    expect(
      await screen.findByText("Your upload didn't finish")
    ).toBeInTheDocument();
    const body = container.querySelector('[class*="errorBody"]');
    expect(body?.textContent).toContain('This is a big file');
    expect(body?.textContent).toContain('split it into smaller files');
  });

  it('shows small-file copy when the failed upload is under 10 MB', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'notes.pdf', SMALL);

    await submitForm(container);

    expect(
      await screen.findByText("Couldn't upload your file")
    ).toBeInTheDocument();
    const body = container.querySelector('[class*="errorBody"]');
    expect(body?.textContent).toContain(
      'The connection dropped before the file finished'
    );
  });

  it('hides the "Talk it through" chat toggle on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'notes.pdf', SMALL);

    await submitForm(container);

    await screen.findByRole('button', { name: 'Try again' });
    expect(
      container.querySelector('button[aria-controls="error-state-chat-panel"]')
    ).toBeNull();
  });

  it('Choose a different file returns to the drop zone and clears the input', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const fileInput = selectFile(container, 'notes.pdf', SMALL);

    await submitForm(container);

    const chooseDifferent = await screen.findByRole('button', {
      name: 'Choose a different file',
    });
    fireEvent.click(chooseDifferent);

    expect(screen.getByText('Choose files')).toBeInTheDocument();
    expect(fileInput.value).toBe('');
  });

  it('marks a repeat network failure retry:true without re-firing the server-owned upload_started track', async () => {
    // upload_started is server-owned (UploadService.ts fires it unconditionally
    // on every request that reaches handleUpload, retries included) - a
    // client-side track('upload_started') here would double-count a
    // successful retry and, worse, record a "ghost start" if the retry's own
    // multipart body times out before ever reaching the server.
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'notes.pdf', SMALL);

    await submitForm(container);

    const retry = await screen.findByRole('button', { name: 'Try again' });
    trackMock.mockClear();
    fireEvent.click(retry);

    await waitFor(() => {
      const failed = trackMock.mock.calls.filter(
        ([name]) => name === 'upload_failed'
      );
      expect(failed).toHaveLength(1);
      expect(failed[0][1]).toMatchObject({ reason: 'network', retry: true });
    });
    expect(trackMock).not.toHaveBeenCalledWith(
      'upload_started',
      expect.anything()
    );
  });
});

describe('UploadForm reattach recovery', () => {
  beforeEach(() => {
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    globalThis.sessionStorage.clear();
  });

  afterEach(() => {
    delete (globalThis as AnalyticsGlobals).gtag;
    delete (globalThis as AnalyticsGlobals).hj;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.sessionStorage.clear();
  });

  function selectFile(container: HTMLElement, name: string) {
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['x'], name, { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });
    fileInput.removeAttribute('required');
    return fileInput;
  }

  async function submitForm(container: HTMLElement) {
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });
  }

  it('persists the in-flight filename while the upload request is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {}))
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    expect(globalThis.sessionStorage.getItem('upload_pending_filename')).toBe(
      'biochem.pdf'
    );
  });

  it('clears the pending filename once the server responds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="deck.apkg"',
          'X-Card-Count': '5',
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    await waitFor(() =>
      expect(
        globalThis.sessionStorage.getItem('upload_pending_filename')
      ).toBeNull()
    );
  });

  it('keeps the pending filename after a dropped connection so a reload can recover it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    await screen.findByRole('button', { name: 'Try again' });
    expect(globalThis.sessionStorage.getItem('upload_pending_filename')).toBe(
      'biochem.pdf'
    );
  });

  it('keeps the sent file on this device while the request is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {}))
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    const pending = await getPendingUploadStore().load();
    expect(pending).toMatchObject({ filename: 'biochem.pdf', ownerId: null });
    expect(pending?.files.map((file) => file.name)).toEqual(['biochem.pdf']);
  });

  it('forgets the sent file once the server responds', async () => {
    vi.stubGlobal('fetch', okApkgFetch());
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:deck');

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    await waitFor(async () =>
      expect(await getPendingUploadStore().load()).toBeNull()
    );
  });

  it('forgets the sent file when the server rejects it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 400,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ message: 'Bad file' }),
        text: () => Promise.resolve('{"message":"Bad file"}'),
      })
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    await waitFor(async () =>
      expect(await getPendingUploadStore().load()).toBeNull()
    );
  });

  it('keeps the sent file after a dropped connection, since the deck may still arrive', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    await screen.findByRole('button', { name: 'Try again' });
    expect(await getPendingUploadStore().load()).toMatchObject({
      filename: 'biochem.pdf',
    });
  });

  it('offers nothing and keeps the file when the account lookup failed', async () => {
    await savePending('biochem.pdf');
    mockUseUserLocals.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('down'),
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    await act(async () => {});

    expect(
      screen.queryByRole('button', { name: 'Continue' })
    ).not.toBeInTheDocument();
    expect(await getPendingUploadStore().load()).toMatchObject({
      filename: 'biochem.pdf',
    });
    mockUseUserLocals.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
  });

  it('warns before the page unloads while the upload is in flight', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {}))
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const idleUnload = new Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(idleUnload);
    expect(idleUnload.defaultPrevented).toBe(false);

    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    const busyUnload = new Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(busyUnload);
    expect(busyUnload.defaultPrevented).toBe(true);
  });

  async function savePending(name: string, ownerId: number | null = null) {
    await getPendingUploadStore().save({
      files: [new File(['x'], name, { type: 'application/pdf' })],
      filename: name,
      sizeBytes: 1,
      submittedAt: Date.now(),
      recoveryToken: ownerId == null ? 'token-1' : null,
      ownerId,
      pdfPageRange: '2-4',
      aiFlag: null,
    });
  }

  it('never offers a file an account left behind to the next signed-out visitor', async () => {
    await savePending('private-notes.pdf', 42);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);

    await waitFor(async () =>
      expect(await getPendingUploadStore().load()).toBeNull()
    );
    expect(screen.queryByText(/private-notes\.pdf/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Continue' })
    ).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers to continue a file that did not finish uploading before the reload', async () => {
    await savePending('biochem.pdf');
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);

    expect(
      await screen.findByText("biochem.pdf didn't finish uploading.")
    ).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('upload_resume_shown', {
      state: 'continue',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/upload/file',
        expect.objectContaining({ method: 'post' })
      )
    );
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect((body.get('pakker') as File).name).toBe('biochem.pdf');
    expect(body.get('pdf-page-range')).toBe('2-4');
    expect(track).toHaveBeenCalledWith('upload_resume_clicked');
  });

  it('sends nothing when the pending file was cleared in another tab', async () => {
    await savePending('biochem.pdf');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    const continueButton = await screen.findByRole('button', {
      name: 'Continue',
    });
    await getPendingUploadStore().clear();
    fireEvent.click(continueButton);

    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/upload/file',
      expect.anything()
    );
  });

  it('forgets the file when the user dismisses the offer', async () => {
    await savePending('biochem.pdf');

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

    expect(
      screen.queryByText("biochem.pdf didn't finish uploading.")
    ).not.toBeInTheDocument();
    await waitFor(async () =>
      expect(await getPendingUploadStore().load()).toBeNull()
    );
  });

  it('hands back the deck the server already made instead of converting again', async () => {
    await savePending('biochem.pdf');
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:recovered');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn(),
      getUploads: vi.fn().mockResolvedValue([]),
      getAnonymousRecoveredDeck: vi.fn().mockResolvedValue(new Blob(['APKG'])),
    } as unknown as ReturnType<typeof get2ankiApi>);

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);

    const link = await screen.findByRole('link', { name: 'Download deck' });
    expect(link).toHaveAttribute('href', 'blob:recovered');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('upload_resume_shown', {
      state: 'ready',
    });
    expect(await getPendingUploadStore().load()).toBeNull();
  });

  it('asks to re-attach the file when only its name survived the reload', async () => {
    globalThis.sessionStorage.setItem('upload_pending_filename', 'big.zip');

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);

    const banner = (await screen.findByText(/Re-attach/)).closest(
      '[role="status"]'
    ) as HTMLElement;
    expect(banner.textContent).toContain('big.zip');
    expect(banner.textContent).toContain('to convert');
    expect(track).toHaveBeenCalledWith('upload_reattach_shown');
  });

  it('shows no offer when nothing was pending', async () => {
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    await act(async () => {});
    expect(screen.queryByText(/Re-attach/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Continue' })
    ).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalledWith(
      'upload_resume_shown',
      expect.anything()
    );
  });
});

describe('UploadForm signed-in deck recovery', () => {
  const authedData = {
    user: { id: 1 },
    locals: {
      owner: 1,
      patreon: false,
      subscriber: false,
      subscriptionInfo: { active: false, email: '', linked_email: '' },
    },
    linked_email: '',
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  beforeEach(() => {
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    globalThis.sessionStorage.clear();
    mockUseUserLocals.mockReturnValue({
      data: authedData,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    delete (globalThis as AnalyticsGlobals).gtag;
    delete (globalThis as AnalyticsGlobals).hj;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.sessionStorage.clear();
  });

  function selectFile(container: HTMLElement, name: string) {
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['x'], name, { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });
    fileInput.removeAttribute('required');
    return fileInput;
  }

  async function submitForm(container: HTMLElement) {
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });
  }

  function makeUpload() {
    return {
      id: '1',
      size_mb: 1,
      owner: 1,
      key: 'recovered-key',
      filename: 'biochem',
      object_id: 'obj-1',
      created_at: new Date().toISOString(),
      source: null,
    };
  }

  it('finds the deck in My Decks after a reload instead of offering to send it again', async () => {
    await getPendingUploadStore().save({
      files: [new File(['x'], 'biochem.pdf', { type: 'application/pdf' })],
      filename: 'biochem.pdf',
      sizeBytes: 1,
      submittedAt: Date.now() - 5_000,
      recoveryToken: null,
      ownerId: 1,
      pdfPageRange: null,
      aiFlag: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn(),
      getHeldDeck: vi.fn().mockResolvedValue(null),
      getUploads: vi.fn().mockResolvedValue([makeUpload()]),
    } as unknown as ReturnType<typeof get2ankiApi>);

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);

    const link = await screen.findByRole('link', { name: 'Download deck' });
    expect(link).toHaveAttribute('href', '/api/download/u/recovered-key');
    expect(
      screen.queryByRole('button', { name: 'Continue' })
    ).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/upload/file',
      expect.anything()
    );
  });

  it('recovers a signed-in deck from My Decks when the response is lost', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn(),
      getHeldDeck: vi.fn().mockResolvedValue(null),
      getUploads: vi.fn().mockResolvedValue([makeUpload()]),
    } as unknown as ReturnType<typeof get2ankiApi>);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    const link = await screen.findByRole('link', { name: 'Download deck' });
    expect(link).toHaveAttribute('href', '/api/download/u/recovered-key');
    expect(
      screen.queryByRole('button', { name: 'Try again' })
    ).not.toBeInTheDocument();
    expect(
      globalThis.sessionStorage.getItem('upload_pending_filename')
    ).toBeNull();
  });

  it('keeps checking My Decks while the deck is built, and says it will be there', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );
    vi.mocked(dropWaitDelays).mockReturnValueOnce([0, 0]);
    const getUploads = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeUpload()]);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn(),
      getHeldDeck: vi.fn().mockResolvedValue(null),
      getUploads,
    } as unknown as ReturnType<typeof get2ankiApi>);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    const link = await screen.findByRole('link', { name: 'Download deck' });
    expect(link).toHaveAttribute('href', '/api/download/u/recovered-key');
    expect(getUploads).toHaveBeenCalledTimes(3);
  });

  it('falls back to the retry state when My Decks has no matching deck', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn(),
      getHeldDeck: vi.fn().mockResolvedValue(null),
      getUploads: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof get2ankiApi>);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    await screen.findByRole('button', { name: 'Try again' });
    expect(
      screen.queryByRole('link', { name: 'Download deck' })
    ).not.toBeInTheDocument();
  });
});

describe('UploadForm anonymous deck recovery', () => {
  const anonymousData = {
    user: null,
    locals: {
      owner: 0,
      patreon: false,
      subscriber: false,
      subscriptionInfo: { active: false, email: '', linked_email: '' },
    },
    linked_email: '',
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  beforeEach(() => {
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    globalThis.sessionStorage.clear();
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:recovered');
    mockUseUserLocals.mockReturnValue({
      data: anonymousData,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    delete (globalThis as AnalyticsGlobals).gtag;
    delete (globalThis as AnalyticsGlobals).hj;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.sessionStorage.clear();
  });

  function selectFile(container: HTMLElement, name: string) {
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['x'], name, { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });
    fileInput.removeAttribute('required');
    return fileInput;
  }

  async function submitForm(container: HTMLElement) {
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });
  }

  function stubApi(getAnonymousRecoveredDeck: ReturnType<typeof vi.fn>) {
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn(),
      getHeldDeck: vi.fn().mockResolvedValue(null),
      getAnonymousRecoveredDeck,
    } as unknown as ReturnType<typeof get2ankiApi>);
  }

  function uploadToken(fetchMock: ReturnType<typeof vi.fn>): string | null {
    const call = fetchMock.mock.calls.find(
      ([url]) => url === '/api/upload/file'
    );
    const headers = call?.[1]?.headers as Record<string, string> | undefined;
    return headers?.['X-Recovery-Token'] ?? null;
  }

  it('sends a recovery token and fetches the stored deck when the response is lost', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const getAnonymousRecoveredDeck = vi
      .fn()
      .mockResolvedValue(new Blob(['apkg']));
    stubApi(getAnonymousRecoveredDeck);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    const link = await screen.findByRole('link', { name: 'Download deck' });
    expect(link).toHaveAttribute('href', 'blob:recovered');
    const token = uploadToken(fetchMock);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(getAnonymousRecoveredDeck).toHaveBeenCalledWith(token);
    expect(
      screen.getByText(
        "Your download didn't finish — your deck is ready. Download it now; we only keep it for a day."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' })
    ).not.toBeInTheDocument();
  });

  it('keeps looking through a busy-storage answer, then shows the deck', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );
    vi.mocked(dropWaitDelays).mockReturnValueOnce([0, 0, 0]);
    const getAnonymousRecoveredDeck = vi
      .fn()
      .mockRejectedValueOnce(new RecoveryStorageBusyError())
      .mockRejectedValueOnce(new RecoveryStorageBusyError())
      .mockResolvedValueOnce(new Blob(['apkg']));
    stubApi(getAnonymousRecoveredDeck);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    const link = await screen.findByRole('link', { name: 'Download deck' });
    expect(link).toHaveAttribute('href', 'blob:recovered');
    expect(getAnonymousRecoveredDeck).toHaveBeenCalledTimes(3);
  });

  it('keeps looking while the server finishes the deck, then shows it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );
    vi.mocked(dropWaitDelays).mockReturnValueOnce([0, 0, 0]);
    const getAnonymousRecoveredDeck = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Blob(['apkg']));
    stubApi(getAnonymousRecoveredDeck);
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    const link = await screen.findByRole('link', { name: 'Download deck' });
    expect(link).toHaveAttribute('href', 'blob:recovered');
    expect(getAnonymousRecoveredDeck).toHaveBeenCalledTimes(3);
    expect(
      screen.queryByRole('button', { name: 'Try again' })
    ).not.toBeInTheDocument();
    expect(trackMock).toHaveBeenCalledWith(
      'upload_failed',
      expect.objectContaining({
        reason: 'network',
        recovered: true,
        trigger: 'wait',
      })
    );
  });

  it('tells the visitor the deck is still being built and lets them stop waiting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );
    vi.mocked(dropWaitDelays).mockReturnValueOnce([60_000]);
    stubApi(vi.fn().mockResolvedValue(null));

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    expect(
      await screen.findByText(
        "Your connection dropped, but we're still building your deck. Keep this tab open and it will appear here."
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));

    await screen.findByRole('button', { name: 'Try again' });
    expect(screen.queryByRole('button', { name: 'Stop waiting' })).toBeNull();
  });

  it('records no upload failure when the page is closed while waiting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );
    vi.mocked(dropWaitDelays).mockReturnValueOnce([60_000]);
    stubApi(vi.fn().mockResolvedValue(null));
    const trackMock = vi.mocked(track);

    const { container, unmount } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);
    await screen.findByRole('button', { name: 'Stop waiting' });
    trackMock.mockClear();

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(trackMock).not.toHaveBeenCalledWith(
      'upload_failed',
      expect.anything()
    );
  });

  it('falls back to the retry state when no deck was stored', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );
    stubApi(vi.fn().mockResolvedValue(null));

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    await screen.findByRole('button', { name: 'Try again' });
    expect(
      screen.queryByRole('link', { name: 'Download deck' })
    ).not.toBeInTheDocument();
  });

  it('fetches a copy that finished after the drop when the user taps Try again', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const getAnonymousRecoveredDeck = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Blob(['apkg']));
    stubApi(getAnonymousRecoveredDeck);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    const link = await screen.findByRole('link', { name: 'Download deck' });
    expect(link).toHaveAttribute('href', 'blob:recovered');
    const token = uploadToken(fetchMock);
    expect(getAnonymousRecoveredDeck).toHaveBeenNthCalledWith(2, token);
    const uploads = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/upload/file'
    );
    expect(uploads).toHaveLength(1);
  });

  it('re-uploads with the same token when Try again finds no copy', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    stubApi(vi.fn().mockResolvedValue(null));

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      const uploads = fetchMock.mock.calls.filter(
        ([url]) => url === '/api/upload/file'
      );
      expect(uploads).toHaveLength(2);
    });
    const tokens = fetchMock.mock.calls
      .filter(([url]) => url === '/api/upload/file')
      .map(
        ([, init]) =>
          (init.headers as Record<string, string>)['X-Recovery-Token']
      );
    expect(tokens[1]).toBe(tokens[0]);
  });

  it('falls back to the retry state when the recovery lookup itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );
    stubApi(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'biochem.pdf');
    await submitForm(container);

    await screen.findByRole('button', { name: 'Try again' });
  });
});

describe('UploadForm thin-deck notice', () => {
  const payingData = {
    user: { id: 1, email: 'learner@example.com' },
    locals: { owner: 1, patreon: false, subscriber: true },
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  const freeSignedInData = {
    user: { id: 2, email: 'free@example.com' },
    locals: { owner: 2, patreon: false, subscriber: false },
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  const anonymousData = {
    user: null,
    locals: { owner: 0, patreon: false, subscriber: false },
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  function setUserLocals(data: ReturnType<typeof useUserLocals>['data']) {
    mockUseUserLocals.mockReturnValue({
      data,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    });
  }

  beforeEach(() => {
    vi.mocked(track).mockClear();
    mockUseCardUsage.mockReturnValue(null);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
      getUploads: vi.fn().mockResolvedValue([]),
      getHeldDeck: vi.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof get2ankiApi>);
  });

  afterEach(() => {
    setUserLocals(undefined);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
      getUploads: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof get2ankiApi>);
    vi.unstubAllGlobals();
  });

  function stubSuccess(headers: Record<string, string>) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="deck.apkg"',
          ...headers,
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );
  }

  function uploadFile(container: HTMLElement, filename: string) {
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['x'], filename)],
      configurable: true,
    });
    const form = container.querySelector('form')!;
    return act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });
  }

  it('shows the paid-AI copy for an anonymous thin PDF deck', async () => {
    setUserLocals(anonymousData);
    stubSuccess({ 'X-Card-Count': '2' });

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await uploadFile(container, 'notes.pdf');

    expect(
      await screen.findByText(
        'Only 2 cards came from this file. Claude can write more cards from it on a paid plan.'
      )
    ).toBeInTheDocument();
    expect(vi.mocked(track)).toHaveBeenCalledWith('thin_deck_notice_shown', {
      reason: 'fewCardsPaidAi',
      cards: 2,
      skipped: 0,
      surface: 'upload',
    });
  });

  it('shows the paid-AI copy for a free signed-in thin TXT deck', async () => {
    setUserLocals(freeSignedInData);
    stubSuccess({ 'X-Card-Count': '1' });

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await uploadFile(container, 'notes.txt');

    expect(
      await screen.findByText(
        'Only 1 card came from this file. Claude can write more cards from it on a paid plan.'
      )
    ).toBeInTheDocument();
  });

  it('shows the turn-on copy for a paying user with Claude off and some credits left', async () => {
    setUserLocals(payingData);
    stubSuccess({ 'X-Card-Count': '2' });
    const deckFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        url === '/api/ai/credits'
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  credits: 12,
                  used: 288,
                  allowance: 300,
                  usable: true,
                  windowEnd: null,
                  resets: 'period',
                }),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                }
              )
            )
          : deckFetch(url, init)
      )
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await uploadFile(container, 'notes.pdf');

    expect(
      await screen.findByText(
        'Only 2 cards came from this file. Turn on Claude cards above and convert again to get more.'
      )
    ).toBeInTheDocument();
    expect(vi.mocked(track)).toHaveBeenCalledWith('thin_deck_notice_shown', {
      reason: 'fewCards',
      cards: 2,
      skipped: 0,
      surface: 'upload',
    });
  });

  it('shows the turn-on copy for a paying user once a failed credits read has finished', async () => {
    setUserLocals(payingData);
    stubSuccess({ 'X-Card-Count': '2' });
    const deckFetch = globalThis.fetch;
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      url === '/api/ai/credits'
        ? Promise.resolve(new Response('', { status: 500 }))
        : deckFetch(url, init)
    );
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await uploadFile(container, 'notes.pdf');

    expect(
      await screen.findByText(
        'Only 2 cards came from this file. Turn on Claude cards above and convert again to get more.'
      )
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/ai/credits').length
    ).toBeGreaterThan(0);
  });

  function stubCreditsAnswer(answer: () => Promise<Response>) {
    stubSuccess({ 'X-Card-Count': '2' });
    const deckFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        url === '/api/ai/credits' ? answer() : deckFetch(url, init)
      )
    );
  }

  const TURN_ON_COPY =
    'Only 2 cards came from this file. Turn on Claude cards above and convert again to get more.';

  // Fake time moves only when a test moves it, in small steps, so a slow
  // machine cannot run the two-second wait out early.
  async function stepUntil(found: () => boolean) {
    for (let step = 0; step < 300 && !found(); step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
    }
  }

  async function showThinPdfDeckUnderFakeTime() {
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await uploadFile(container, 'notes.pdf');
    await stepUntil(
      () => screen.queryByRole('button', { name: 'Make another deck' }) != null
    );
    expect(
      screen.getByRole('button', { name: 'Make another deck' })
    ).toBeInTheDocument();
  }

  it('shows the turn-on copy for a paying user whose credits read has not answered within two seconds', async () => {
    setUserLocals(payingData);
    stubCreditsAnswer(() => new Promise<Response>(() => {}));
    vi.useFakeTimers();
    try {
      await showThinPdfDeckUnderFakeTime();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1900);
      });
      expect(screen.queryByText(/came from this file/)).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(screen.getByText(TURN_ON_COPY)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the turn-on copy, shown once, when a credits read that outlasted the wait answers with no credits left', async () => {
    setUserLocals(payingData);
    let answerCredits: (response: Response) => void = () => undefined;
    stubCreditsAnswer(
      () =>
        new Promise<Response>((resolve) => {
          answerCredits = resolve;
        })
    );
    vi.useFakeTimers();
    try {
      await showThinPdfDeckUnderFakeTime();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(screen.getByText(TURN_ON_COPY)).toBeInTheDocument();

      await act(async () => {
        answerCredits(
          new Response(
            JSON.stringify({
              credits: 0,
              used: 300,
              allowance: 300,
              usable: true,
              windowEnd: null,
              resets: 'period',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
        await vi.advanceTimersByTimeAsync(200);
      });

      expect(screen.getByText(TURN_ON_COPY)).toBeInTheDocument();
      expect(
        vi
          .mocked(track)
          .mock.calls.filter(([name]) => name === 'thin_deck_notice_shown')
      ).toEqual([
        [
          'thin_deck_notice_shown',
          { reason: 'fewCards', cards: 2, skipped: 0, surface: 'upload' },
        ],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a paying user whose plan has no AI allowance the turn-on copy, with no zero line or buy button', async () => {
    setUserLocals(payingData);
    stubCreditsAnswer(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            credits: 0,
            used: 0,
            allowance: 0,
            usable: false,
            windowEnd: null,
            resets: 'month',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await uploadFile(container, 'notes.pdf');

    expect(
      await screen.findByText(
        'Only 2 cards came from this file. Turn on Claude cards above and convert again to get more.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Buy 250 credits/ })
    ).toBeNull();
  });

  it('hides the notice when Claude cards are already on', async () => {
    setUserLocals(payingData);
    stubSuccess({ 'X-Card-Count': '2' });

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn />
    );
    await uploadFile(container, 'notes.pdf');

    await screen.findByRole('button', { name: 'Make another deck' });
    expect(screen.queryByText(/came from this file/)).toBeNull();
  });

  it('hides the notice when the monthly limit held cards back', async () => {
    setUserLocals(freeSignedInData);
    stubSuccess({ 'X-Card-Count': '2', 'X-Cards-Held-Back': '5' });

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await uploadFile(container, 'notes.pdf');

    await screen.findByRole('button', { name: 'Make another deck' });
    expect(screen.queryByText(/came from this file/)).toBeNull();
  });

  it('hides the notice when a PDF makes three or more cards', async () => {
    setUserLocals(anonymousData);
    stubSuccess({ 'X-Card-Count': '5' });

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await uploadFile(container, 'notes.pdf');

    await screen.findByRole('button', { name: 'Make another deck' });
    expect(screen.queryByText(/came from this file/)).toBeNull();
  });

  it('hides the notice for a thin non-PDF or TXT upload', async () => {
    setUserLocals(anonymousData);
    stubSuccess({ 'X-Card-Count': '2' });

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await uploadFile(container, 'notes.zip');

    await screen.findByRole('button', { name: 'Make another deck' });
    expect(screen.queryByText(/came from this file/)).toBeNull();
  });

  it('hides the notice for a thin Kindle clippings file', async () => {
    setUserLocals(anonymousData);
    stubSuccess({ 'X-Card-Count': '2' });

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await uploadFile(container, 'My Clippings.txt');

    await screen.findByRole('button', { name: 'Make another deck' });
    expect(screen.queryByText(/came from this file/)).toBeNull();
  });
});

describe('UploadForm Claude rebuild offer for a paying account with AI off', () => {
  const offerWith = (creditsLeft: number) =>
    `This deck was made without AI. Rebuilding uses your AI credits (${creditsLeft} left). The new deck appears in My decks.`;
  const OFFER = offerWith(1347);

  const passHolder = {
    user: { id: 7, email: 'learner@example.com' },
    locals: {
      owner: 7,
      patreon: false,
      subscriber: true,
      passKind: '120d',
      planSource: null,
    },
    features: {},
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  const otherPassHolder = {
    user: { id: 9, email: 'next@example.com' },
    locals: {
      owner: 9,
      patreon: false,
      subscriber: true,
      passKind: '120d',
      planSource: null,
    },
    features: {},
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  const passHolderWithThinDeckOffer = {
    user: { id: 7, email: 'learner@example.com' },
    locals: {
      owner: 7,
      patreon: false,
      subscriber: true,
      passKind: '120d',
      planSource: null,
    },
    features: { thinDeckAiOffer: true },
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  const otherPassHolderWithThinDeckOffer = {
    user: { id: 9, email: 'next@example.com' },
    locals: {
      owner: 9,
      patreon: false,
      subscriber: true,
      passKind: '120d',
      planSource: null,
    },
    features: { thinDeckAiOffer: true },
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  const payingWithoutAccount = {
    user: null,
    locals: { owner: 0, patreon: false, subscriber: true, passKind: '24h' },
    features: {},
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  const signedOutWithAiPreview = {
    user: null,
    locals: { owner: 0, patreon: false, subscriber: false },
    features: { anonymousAiPreview: true },
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  const freeSignedIn = {
    user: { id: 8, email: 'free@example.com' },
    locals: { owner: 8, patreon: false, subscriber: false },
    features: {},
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  const signedOut = {
    user: null,
    locals: { owner: 0, patreon: false, subscriber: false },
    features: {},
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  const trackMock = vi.mocked(track);

  let readLocalsAgain: Mock = vi.fn();

  const answered = (data: ReturnType<typeof useUserLocals>['data']) => ({
    data,
    status: 'success',
    isError: false,
  });

  function setUserLocals(data: ReturnType<typeof useUserLocals>['data']) {
    readLocalsAgain = vi.fn().mockResolvedValue(answered(data));
    mockUseUserLocals.mockReturnValue({
      data,
      isLoading: false,
      error: null,
      isError: false,
      refetch: readLocalsAgain,
    });
  }

  // Another account signs in from another tab, and this window has not
  // noticed: its locals still show the old account until the page reads them
  // again, which then answers with the new one.
  function signInElsewhere(
    next: ReturnType<typeof useUserLocals>['data'] = otherPassHolder
  ) {
    readLocalsAgain.mockImplementation(async () => {
      setUserLocals(next);
      return answered(next);
    });
  }

  // The next read of the account fails: React Query keeps the last data and
  // reports the error.
  function failAccountRead() {
    readLocalsAgain.mockResolvedValue({
      data: passHolder,
      status: 'error',
      isError: true,
    });
  }

  // The next read of the account answers only when released.
  function holdAccountRead(): () => void {
    let release = () => {};
    readLocalsAgain.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(answered(passHolder));
      })
    );
    return () => release();
  }

  function jsonAnswer(
    status: number,
    body: unknown,
    headers: Record<string, string> = {}
  ) {
    return {
      redirected: false,
      status,
      clone: () => ({ json: () => Promise.resolve(body) }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
      headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
    };
  }

  // The session the server says an upload ran under.
  const sentBy = (owner: string) => ({ 'X-Upload-Owner': owner });

  // The page's first account read failed for good, so it has no account
  // data; the next read answers with `next`.
  function accountReadFailed(next: ReturnType<typeof useUserLocals>['data']) {
    readLocalsAgain = vi.fn(async () => {
      setUserLocals(next);
      return answered(next);
    });
    mockUseUserLocals.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('locals'),
      isError: true,
      refetch: readLocalsAgain,
    } as unknown as ReturnType<typeof useUserLocals>);
  }

  const emptyExport = {
    code: 'empty_export',
    message: 'No cards were found in this file.',
    filename: 'notes.html',
    docsLink: '/documentation/help/common-problems',
    empty_reason: 'no_toggles',
  };

  const pdfQuestion = jsonAnswer(409, {
    code: 'choose_pdf_mode',
    reason: 'no_text',
    page_count: 14,
  });

  const networkDrop = new TypeError('Failed to fetch');

  function withThinDeckPreview() {
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
      getUploads: vi.fn().mockResolvedValue([]),
      getHeldDeck: vi.fn().mockResolvedValue(null),
      previewThinDeckAi: vi.fn().mockResolvedValue({
        kind: 'preview',
        cards: [{ front: 'What does the Krebs cycle make?', back: 'ATP' }],
      }),
    } as unknown as ReturnType<typeof get2ankiApi>);
  }

  function deckResponse(cards: number, headers: Record<string, string> = {}) {
    return {
      redirected: false,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'File-Name': encodeURIComponent('lecture.apkg'),
        'X-Card-Count': String(cards),
        ...headers,
      }),
      blob: () => Promise.resolve(new Blob(['apkg'])),
    };
  }

  function creditsResponse(credits: number): Response {
    return new Response(
      JSON.stringify({
        credits,
        used: 1500 - credits,
        allowance: 1500,
        usable: true,
        windowEnd: null,
        resets: 'pass',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const asyncJobAccepted = {
    redirected: false,
    status: 202,
    headers: new Headers({ 'Content-Type': 'application/json' }),
  };

  type UploadAnswer =
    | ReturnType<typeof deckResponse>
    | typeof asyncJobAccepted
    | ReturnType<typeof jsonAnswer>
    | Error
    | Promise<never>;

  function stubServer(answers: UploadAnswer[], credits = 1347): Mock {
    const pending = [...answers];
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/ai/credits') {
        return Promise.resolve(creditsResponse(credits));
      }
      if (url === '/api/upload/file' || url === '/api/upload/dropbox') {
        const answer = pending.length > 1 ? pending.shift() : pending[0];
        if (answer instanceof Promise) return answer;
        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve(answer);
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function stubLeavingPage() {
    const locationStub = { href: '', origin: 'http://localhost', search: '' };
    vi.stubGlobal('location', locationStub);
    return locationStub;
  }

  const needsPassword = {
    redirected: false,
    status: 400,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    clone: () => ({
      json: () =>
        Promise.resolve({
          error: 'needs_password',
          reason: 'missing_password',
        }),
    }),
  };

  function stubLockedPdfServer(unlockedCards: number): Mock {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/ai/credits') {
        return Promise.resolve(creditsResponse(1347));
      }
      if (url === '/api/upload/file') {
        return Promise.resolve(needsPassword);
      }
      if (url === '/api/upload/retry-with-credential') {
        return Promise.resolve(deckResponse(unlockedCards));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  async function unlockWithPassword() {
    fireEvent.change(await screen.findByLabelText('PDF password'), {
      target: { value: 'open-sesame' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    });
  }

  const callsTo = (fetchMock: Mock, url: string) =>
    fetchMock.mock.calls.filter(([calledUrl]) => calledUrl === url);

  const eventsNamed = (event: string) =>
    trackMock.mock.calls.filter(([name]) => name === event);

  const shownEvents = () => eventsNamed('upload_ai_rebuild_shown');

  const OTHER_ACCOUNT_LINE =
    "You're signed in to a different account now. Choose the file again to convert it there.";
  const SIGNED_OUT_LINE =
    "You're signed out now. Choose the file again to convert it here.";
  const SIGNED_IN_LINE =
    "You're signed in now. Choose the file again to save it to your account.";
  const CHECKING = "Checking who's signed in";
  const SENDER_UNKNOWN =
    "Couldn't tell which account sent this file, so nothing was sent. Choose the file again.";
  const UNCONFIRMED =
    "Couldn't confirm which account you're signed in to, so nothing was sent. Check your connection and try again.";

  // One QueryClient for the whole test, so a re-render with a new AI toggle
  // or a new account keeps the cache the page already had.
  function renderRebuildForm(aiOn: boolean) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (nextAiOn: boolean) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <UploadForm setErrorMessage={vi.fn()} aiOn={nextAiOn} />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const view = render(tree(aiOn));
    return {
      ...view,
      rerenderWithAi: (nextAiOn: boolean) => view.rerender(tree(nextAiOn)),
    };
  }

  async function submitFiles(
    container: HTMLElement,
    files: Array<string | File>
  ) {
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: files.map((file) =>
        typeof file === 'string' ? new File(['x'], file) : file
      ),
      configurable: true,
    });
    input.removeAttribute('required');
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }

  beforeEach(() => {
    trackMock.mockClear();
    mockUseCardUsage.mockReturnValue(null);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
      getUploads: vi.fn().mockResolvedValue([]),
      getHeldDeck: vi.fn().mockResolvedValue(null),
      previewThinDeckAi: vi.fn(),
    } as unknown as ReturnType<typeof get2ankiApi>);
    globalThis.localStorage.clear();
    globalThis.localStorage.setItem('claude-ai-flashcards', 'false');
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:deck');
    setUserLocals(passHolder);
  });

  afterEach(() => {
    setUserLocals(undefined);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
      getUploads: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof get2ankiApi>);
    globalThis.localStorage.clear();
    clearThinDeckResume();
    vi.unstubAllGlobals();
  });

  it('offers a pass holder a Claude rebuild of a 64-card PDF deck and sends the file to the background job with AI on', async () => {
    const locationStub = stubLeavingPage();
    const fetchMock = stubServer([deckResponse(64), asyncJobAccepted]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);

    expect(await screen.findByText(OFFER)).toBeInTheDocument();
    expect(shownEvents()).toEqual([
      ['upload_ai_rebuild_shown', { format: 'pdf' }],
    ]);

    fireEvent.click(
      screen.getByRole('button', { name: 'Rebuild with Claude' })
    );

    await waitFor(() => expect(locationStub.href).toBe('/downloads?started=1'));
    expect(trackMock).toHaveBeenCalledWith('upload_ai_rebuild_clicked', {
      format: 'pdf',
    });
    const uploads = callsTo(fetchMock, '/api/upload/file');
    expect(uploads).toHaveLength(2);
    const resent = uploads[1][1].body as FormData;
    expect(resent.getAll('claude-ai-flashcards')).toEqual(['true']);
    expect((resent.get('pakker') as File).name).toBe('lecture.pdf');
  });

  it('offers no second rebuild when the AI resend still comes back as a deck', async () => {
    const fetchMock = stubServer([deckResponse(64), deckResponse(64)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Rebuild with Claude' })
    );

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2)
    );
    await screen.findByRole('button', { name: 'Make another deck' });
    await settle();
    expect(screen.queryByText(OFFER)).toBeNull();
    expect(shownEvents()).toHaveLength(1);
  });

  it.each([
    [
      'a Stripe subscriber',
      { owner: 7, patreon: false, subscriber: true, planSource: 'stripe' },
    ],
    [
      'a lifetime account',
      { owner: 7, patreon: true, subscriber: false, planSource: 'lifetime' },
    ],
    [
      'an Apple Pro account',
      {
        owner: 7,
        patreon: false,
        subscriber: true,
        passKind: 'unlimited',
        planSource: 'apple',
      },
    ],
  ])('offers the rebuild to %s', async (_population, locals) => {
    setUserLocals({
      user: { id: 7, email: 'learner@example.com' },
      locals,
      features: {},
    } as unknown as ReturnType<typeof useUserLocals>['data']);
    stubServer([deckResponse(64)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);

    expect(await screen.findByText(OFFER)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Rebuild with Claude' })
    ).toBeInTheDocument();
  });

  it.each([
    ['slides.pptx', 'pptx'],
    ['slides.ppt', 'ppt'],
    ['LECTURE.PDF', 'pdf'],
  ])(
    'offers the rebuild for %s and records the %s format',
    async (filename, format) => {
      stubServer([deckResponse(64)]);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      await submitFiles(container, [filename]);

      expect(await screen.findByText(OFFER)).toBeInTheDocument();
      expect(shownEvents()).toEqual([['upload_ai_rebuild_shown', { format }]]);
    }
  );

  it.each([
    {
      reason: 'a signed-in free account',
      user: freeSignedIn,
      aiOn: false,
      files: ['lecture.pdf'],
    },
    {
      reason: 'a signed-out visitor',
      user: signedOut,
      aiOn: false,
      files: ['lecture.pdf'],
    },
    {
      reason: 'AI already on',
      user: passHolder,
      aiOn: true,
      files: ['lecture.pdf'],
    },
    {
      reason: 'two files in one upload',
      user: passHolder,
      aiOn: false,
      files: ['part-1.pdf', 'part-2.pdf'],
    },
    {
      reason: 'a .csv file',
      user: passHolder,
      aiOn: false,
      files: ['cards.csv'],
    },
  ])('offers no rebuild for $reason', async ({ user, aiOn, files }) => {
    setUserLocals(user);
    if (aiOn) globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    stubServer([deckResponse(64)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={aiOn} />
    );
    await submitFiles(container, files);

    await screen.findByRole('button', { name: 'Make another deck' });
    await settle();
    expect(screen.queryByText(OFFER)).toBeNull();
    expect(shownEvents()).toEqual([]);
  });

  it('offers no rebuild to a free account whose deck stopped at the monthly limit', async () => {
    setUserLocals(freeSignedIn);
    stubServer([
      deckResponse(42, { 'X-Cards-Held-Back': '300', 'X-Held-For-Plan': '1' }),
    ]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);

    expect(
      await screen.findByText('This deck has 42 of 342 cards')
    ).toBeInTheDocument();
    await settle();
    expect(screen.queryByText(OFFER)).toBeNull();
    expect(shownEvents()).toEqual([]);
  });

  it('offers no rebuild once the plan has no AI credits left', async () => {
    const fetchMock = stubServer([deckResponse(64)], 0);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);

    await screen.findByRole('button', { name: 'Make another deck' });
    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/ai/credits').length).toBeGreaterThan(0)
    );
    await settle();
    expect(screen.queryByText(OFFER)).toBeNull();
    expect(shownEvents()).toEqual([]);
  });

  it('offers no rebuild when the server already spent credits on the deck', async () => {
    stubServer([deckResponse(64, { 'X-Credits-Used': '12' })]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);

    expect(
      await screen.findByText('This deck used 12 AI credits.')
    ).toBeInTheDocument();
    await settle();
    expect(screen.queryByText(OFFER)).toBeNull();
  });

  it('offers no rebuild of a PDF while two pages make one card, which skips Claude for PDFs', async () => {
    globalThis.localStorage.setItem('pdf-page-pairs', 'true');
    stubServer([deckResponse(16)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);

    await screen.findByRole('button', { name: 'Make another deck' });
    await settle();
    expect(screen.queryByText(OFFER)).toBeNull();
  });

  it('offers the rebuild of a PDF without readable text that became page images', async () => {
    globalThis.localStorage.setItem('pdf-fallback', 'pairs');
    const locationStub = stubLeavingPage();
    const fetchMock = stubServer([
      deckResponse(14, { 'X-Pdf-Fallback': 'pairs' }),
      asyncJobAccepted,
    ]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['scan.pdf']);

    expect(await screen.findByText(OFFER)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Rebuild with Claude' })
    );

    await waitFor(() => expect(locationStub.href).toBe('/downloads?started=1'));
    const resent = callsTo(fetchMock, '/api/upload/file')[1][1]
      .body as FormData;
    expect(resent.getAll('claude-ai-flashcards')).toEqual(['true']);
    expect(resent.getAll('pdf-fallback')).toEqual(['pairs']);
  });

  it('puts the rebuild in place of the turn-on notice on a thin PDF deck, without showing the notice first', async () => {
    stubServer([deckResponse(2)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['notes.pdf']);

    expect(await screen.findByText(OFFER)).toBeInTheDocument();
    expect(screen.queryByText(/came from this file/)).toBeNull();
    expect(trackMock).not.toHaveBeenCalledWith(
      'thin_deck_notice_shown',
      expect.anything()
    );
  });

  it('says only how many cards came on a thin PDF deck once the plan has no AI credits left', async () => {
    const fetchMock = stubServer([deckResponse(2)], 0);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['notes.pdf']);

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/ai/credits').length).toBeGreaterThan(0)
    );
    expect(
      await screen.findByText(
        'Only 2 cards came from this file. Claude can write more with AI credits.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Buy 250 credits for $5' })
    ).toBeInTheDocument();
    await settle();
    expect(screen.queryByText(/Turn on Claude cards above/)).toBeNull();
    expect(screen.queryByText(OFFER)).toBeNull();
  });

  it('keeps the turn-on notice on a thin .txt deck, which has no rebuild', async () => {
    stubServer([deckResponse(1)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['notes.txt']);

    expect(
      await screen.findByText(
        'Only 1 card came from this file. Turn on Claude cards above and convert again to get more.'
      )
    ).toBeInTheDocument();
    await settle();
    expect(screen.queryByText(OFFER)).toBeNull();
    expect(shownEvents()).toEqual([]);
  });

  it('sends the Day Pass token with a password unlock, as the upload does', async () => {
    storePassToken('cs_unlock_pass');
    const fetchMock = stubLockedPdfServer(40);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['locked.pdf']);
    await unlockWithPassword();

    await screen.findByRole('button', { name: 'Make another deck' });
    const [, init] = callsTo(fetchMock, '/api/upload/retry-with-credential')[0];
    expect((init as RequestInit).headers).toEqual({
      'X-Pass-Token': 'cs_unlock_pass',
    });
  });

  it('asks for the password again when the unlock fails on the server', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/ai/credits') {
        return Promise.resolve(creditsResponse(1347));
      }
      if (url === '/api/upload/file') {
        return Promise.resolve(needsPassword);
      }
      if (url === '/api/upload/retry-with-credential') {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['locked.pdf']);
    await unlockWithPassword();

    expect(
      await screen.findByText(
        "That didn't open the file. Check for typos and try again."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText('PDF password')).toBeInTheDocument();
  });

  it('follows the server to the limit page when an unlocked PDF is over the card limit', async () => {
    const locationStub = { href: '', origin: 'http://localhost' } as Location;
    vi.stubGlobal('location', locationStub);
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/ai/credits') {
        return Promise.resolve(creditsResponse(1347));
      }
      if (url === '/api/upload/file') {
        return Promise.resolve(needsPassword);
      }
      if (url === '/api/upload/retry-with-credential') {
        return Promise.resolve({
          redirected: true,
          url: 'http://localhost/limit?kind=card_count',
          status: 200,
          headers: new Headers({}),
        });
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['locked.pdf']);
    await unlockWithPassword();

    await waitFor(() => {
      expect(locationStub.href).toBe('http://localhost/limit?kind=card_count');
    });
  });

  it('offers no rebuild of a PDF unlocked with its password, which a resend would not carry', async () => {
    const fetchMock = stubLockedPdfServer(40);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['locked.pdf']);
    await unlockWithPassword();

    await screen.findByRole('button', { name: 'Make another deck' });
    expect(
      callsTo(fetchMock, '/api/upload/retry-with-credential')
    ).toHaveLength(1);
    await settle();
    expect(
      screen.queryByRole('button', { name: 'Rebuild with Claude' })
    ).toBeNull();
    expect(shownEvents()).toEqual([]);
  });

  it.each([
    { population: 'a pass holder', data: passHolder, flag: true },
    { population: 'a signed-in free account', data: freeSignedIn, flag: true },
    { population: 'a signed-out visitor', data: signedOut, flag: true },
    { population: 'a pass holder', data: passHolder, flag: false },
    { population: 'a signed-in free account', data: freeSignedIn, flag: false },
    { population: 'a signed-out visitor', data: signedOut, flag: false },
  ])(
    'leaves a thin deck from a PDF unlocked with its password to the notice for $population, thin-deck offer flag $flag',
    async ({ data, flag }) => {
      setUserLocals({
        ...data,
        features: { thinDeckAiOffer: flag },
      } as unknown as ReturnType<typeof useUserLocals>['data']);
      stubLockedPdfServer(2);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      await submitFiles(container, ['locked.pdf']);
      await unlockWithPassword();

      expect(
        await screen.findByText(/^Only 2 cards came from this file\./)
      ).toBeInTheDocument();
      await settle();
      expect(
        screen.queryByRole('button', {
          name: 'Preview cards Claude would write',
        })
      ).toBeNull();
      expect(screen.queryByText(OFFER)).toBeNull();
    }
  );

  it.each([
    ['a pass holder', passHolder],
    ['a signed-in free account', freeSignedIn],
    ['a signed-out visitor', signedOut],
  ])(
    'leaves a thin PDF deck to its own Claude preview offer for %s',
    async (_population, data) => {
      setUserLocals({
        ...data,
        features: { thinDeckAiOffer: true },
      } as unknown as ReturnType<typeof useUserLocals>['data']);
      stubServer([deckResponse(2)]);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      await submitFiles(container, ['notes.pdf']);

      expect(
        await screen.findByRole('button', {
          name: 'Preview cards Claude would write',
        })
      ).toBeInTheDocument();
      await settle();
      expect(screen.queryByText(OFFER)).toBeNull();
      expect(shownEvents()).toEqual([]);
    }
  );

  it('offers no rebuild for a Dropbox file picked after a local upload', async () => {
    const previousKey = process.env.REACT_APP_DROPBOX_APP_KEY;
    process.env.REACT_APP_DROPBOX_APP_KEY = 'test-key';
    (window as unknown as { Dropbox?: unknown }).Dropbox = {
      choose: ({ success }: { success: (files: unknown[]) => void }) => {
        success([
          {
            id: 'id:9',
            name: 'lecture.pdf',
            bytes: 100,
            icon: 'page',
            isDir: false,
            link: 'https://dl.dropboxusercontent.com/x/lecture.pdf',
            linkType: 'direct',
          },
        ]);
      },
    };
    try {
      const fetchMock = stubServer([deckResponse(64)]);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      await submitFiles(container, ['lecture.pdf']);
      expect(await screen.findByText(OFFER)).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole('button', { name: 'Make another deck' })
      );

      const button = container.querySelector(
        'button[aria-label="Choose from Dropbox"]'
      ) as HTMLButtonElement;
      await act(async () => {
        button.click();
      });

      await waitFor(() =>
        expect(callsTo(fetchMock, '/api/upload/dropbox')).toHaveLength(1)
      );
      await screen.findByRole('button', { name: 'Make another deck' });
      await settle();
      expect(screen.queryByText(OFFER)).toBeNull();
    } finally {
      delete (window as unknown as { Dropbox?: unknown }).Dropbox;
      process.env.REACT_APP_DROPBOX_APP_KEY = previousKey;
    }
  });

  it.each([26, 1347])(
    'says the rebuild spends AI credits, with the %i the plan has left',
    async (creditsLeft) => {
      stubServer([deckResponse(64)], creditsLeft);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      await submitFiles(container, ['lecture.pdf']);

      expect(
        await screen.findByText(offerWith(creditsLeft))
      ).toBeInTheDocument();
    }
  );

  it("offers no rebuild at 25 credits, the badge's low-credit mark, where a background job can run out mid-deck", async () => {
    const fetchMock = stubServer([deckResponse(64)], 25);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);

    await screen.findByRole('button', { name: 'Make another deck' });
    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/ai/credits').length).toBeGreaterThan(0)
    );
    await settle();
    expect(
      screen.queryByRole('button', { name: 'Rebuild with Claude' })
    ).toBeNull();
    expect(shownEvents()).toEqual([]);
  });

  it('asks for Claude with two pages make one card off, so a setting saved on the account cannot skip Claude', async () => {
    stubLeavingPage();
    const fetchMock = stubServer([deckResponse(64), asyncJobAccepted]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Rebuild with Claude' })
    );

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2)
    );
    const resent = callsTo(fetchMock, '/api/upload/file')[1][1]
      .body as FormData;
    expect(resent.getAll('pdf-page-pairs')).toEqual(['false']);
  });

  it('offers no rebuild on a deck recovered from My decks after the connection dropped', async () => {
    const fetchMock = stubServer([networkDrop]);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
      getHeldDeck: vi.fn().mockResolvedValue(null),
      getUploads: vi.fn().mockResolvedValue([
        {
          id: '1',
          size_mb: 1,
          owner: 7,
          key: 'recovered-key',
          filename: 'lecture',
          object_id: 'obj-1',
          created_at: new Date().toISOString(),
          source: null,
        },
      ]),
    } as unknown as ReturnType<typeof get2ankiApi>);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);

    expect(
      await screen.findByRole('link', { name: 'Download deck' })
    ).toHaveAttribute('href', '/api/download/u/recovered-key');
    await settle();
    expect(
      screen.queryByRole('button', { name: 'Rebuild with Claude' })
    ).toBeNull();
    expect(callsTo(fetchMock, '/api/ai/credits')).toHaveLength(0);
  });

  it('keeps Claude on when Try again resends a rebuild whose request never arrived', async () => {
    stubLeavingPage();
    const fetchMock = stubServer([
      deckResponse(64),
      networkDrop,
      asyncJobAccepted,
    ]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Rebuild with Claude' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(3)
    );
    const retried = callsTo(fetchMock, '/api/upload/file')[2][1]
      .body as FormData;
    expect(retried.getAll('claude-ai-flashcards')).toEqual(['true']);
    expect(retried.getAll('pdf-page-pairs')).toEqual(['false']);
  });

  it('keeps the rebuild when Claude is turned on after a deck made without AI', async () => {
    stubServer([deckResponse(64)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['lecture.pdf']);
    expect(await screen.findByText(OFFER)).toBeInTheDocument();

    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    rerenderWithAi(true);
    await settle();

    expect(
      screen.getByRole('button', { name: 'Rebuild with Claude' })
    ).toBeInTheDocument();
    expect(shownEvents()).toHaveLength(1);
  });

  it('puts the rebuild in place of the Claude preview offer when Claude is turned on after a thin PDF deck', async () => {
    setUserLocals(passHolderWithThinDeckOffer);
    stubServer([deckResponse(2)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['notes.pdf']);
    await screen.findByRole('button', {
      name: 'Preview cards Claude would write',
    });

    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    rerenderWithAi(true);

    expect(await screen.findByText(OFFER)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Preview cards Claude would write' })
    ).toBeNull();
  });

  it('puts a line saying why in place of the rebuild once another account signs in on this page', async () => {
    stubServer([deckResponse(64)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['lecture.pdf']);
    expect(await screen.findByText(OFFER)).toBeInTheDocument();

    setUserLocals(otherPassHolder);
    rerenderWithAi(false);
    await settle();

    expect(
      screen.queryByRole('button', { name: 'Rebuild with Claude' })
    ).toBeNull();
    expect(
      screen.getByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose the file again' })
    ).toBeInTheDocument();
  });

  it('offers no rebuild after another account answers the PDF question on this page', async () => {
    const fetchMock = stubServer([
      pdfQuestion,
      deckResponse(14, { 'X-Pdf-Fallback': 'single' }),
    ]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['scan.pdf']);
    const answer = await screen.findByRole('button', {
      name: 'One card per page',
    });

    signInElsewhere();
    fireEvent.click(answer);
    await settle();
    rerenderWithAi(false);

    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: 'Rebuild with Claude' })
    ).toBeNull();
    expect(
      screen.getByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeInTheDocument();
  });

  it('sends Try again under the account the page shows when reading it again hangs', async () => {
    const fetchMock = stubServer([networkDrop, deckResponse(7)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    const retry = await screen.findByRole('button', { name: 'Try again' });

    readLocalsAgain.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(retry);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2)
    );
  });

  it('sends one rebuild and records one click for a double click while the account is read again', async () => {
    stubLeavingPage();
    const fetchMock = stubServer([deckResponse(64), asyncJobAccepted]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    const rebuild = await screen.findByRole('button', {
      name: 'Rebuild with Claude',
    });

    fireEvent.click(rebuild);
    fireEvent.click(rebuild);
    await settle();

    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2);
    expect(eventsNamed('upload_ai_rebuild_clicked')).toEqual([
      ['upload_ai_rebuild_clicked', { format: 'pdf' }],
    ]);
  });

  it('sends nothing and records no click from the rebuild once another account signs in from another tab', async () => {
    const fetchMock = stubServer([deckResponse(64)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    const rebuild = await screen.findByRole('button', {
      name: 'Rebuild with Claude',
    });

    signInElsewhere();
    fireEvent.click(rebuild);
    await settle();

    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
    expect(eventsNamed('upload_ai_rebuild_clicked')).toEqual([]);
  });

  it("sends nothing from the empty state's Make cards with AI under another account, and drops the button once the page shows it", async () => {
    const fetchMock = stubServer([jsonAnswer(400, emptyExport)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['notes.html']);
    const claude = await screen.findByRole('button', {
      name: 'Make cards with AI',
    });

    signInElsewhere();
    fireEvent.click(claude);
    await settle();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
    expect(eventsNamed('upload_ai_rescue_clicked')).toEqual([]);

    rerenderWithAi(false);
    expect(
      screen.queryByRole('button', { name: 'Make cards with AI' })
    ).toBeNull();
    expect(
      screen.getByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeInTheDocument();
  });

  it("sends the PDF back with Claude on from the PDF question's Make cards with AI", async () => {
    stubLeavingPage();
    const fetchMock = stubServer([pdfQuestion, asyncJobAccepted]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['scan.pdf']);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Make cards with AI' })
    );

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2)
    );
    const resent = callsTo(fetchMock, '/api/upload/file')[1][1]
      .body as FormData;
    expect(resent.getAll('claude-ai-flashcards')).toEqual(['true']);
    expect((resent.get('pakker') as File).name).toBe('scan.pdf');
  });

  it("sends nothing from the PDF question's Make cards with AI under another account, and drops the button once the page shows it", async () => {
    const fetchMock = stubServer([pdfQuestion]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['scan.pdf']);
    const claude = await screen.findByRole('button', {
      name: 'Make cards with AI',
    });

    signInElsewhere();
    fireEvent.click(claude);
    await settle();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);

    rerenderWithAi(false);
    expect(
      screen.queryByRole('button', { name: 'Make cards with AI' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'One card per page' })
    ).toBeNull();
    expect(
      screen.getByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeInTheDocument();
  });

  it('sends the thin PDF back with Claude on from Make the full AI deck, and records the tap once it goes out', async () => {
    setUserLocals(passHolderWithThinDeckOffer);
    withThinDeckPreview();
    stubLeavingPage();
    const fetchMock = stubServer([deckResponse(2), asyncJobAccepted]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['notes.pdf']);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Preview cards Claude would write',
      })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Make the full AI deck' })
    );

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2)
    );
    const resent = callsTo(fetchMock, '/api/upload/file')[1][1]
      .body as FormData;
    expect(resent.getAll('claude-ai-flashcards')).toEqual(['true']);
    expect((resent.get('pakker') as File).name).toBe('notes.pdf');
    expect(eventsNamed('thin_deck_ai_unlock_clicked')).toEqual([
      ['thin_deck_ai_unlock_clicked', { plan: 'paying' }],
    ]);
  });

  it('sends nothing from Make the full AI deck under another account, and drops the offer once the page shows it', async () => {
    setUserLocals(passHolderWithThinDeckOffer);
    withThinDeckPreview();
    const fetchMock = stubServer([deckResponse(2)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['notes.pdf']);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Preview cards Claude would write',
      })
    );
    const fullDeck = await screen.findByRole('button', {
      name: 'Make the full AI deck',
    });

    signInElsewhere(otherPassHolderWithThinDeckOffer);
    fireEvent.click(fullDeck);
    await settle();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
    expect(eventsNamed('thin_deck_ai_unlock_clicked')).toEqual([]);

    rerenderWithAi(false);
    expect(
      screen.queryByRole('button', { name: 'Make the full AI deck' })
    ).toBeNull();
    expect(
      screen.getByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeInTheDocument();
  });

  it('makes the full AI deck with Claude even while this browser makes two pages one card', async () => {
    globalThis.localStorage.setItem('pdf-page-pairs', 'true');
    setUserLocals(passHolderWithThinDeckOffer);
    withThinDeckPreview();
    stubLeavingPage();
    const fetchMock = stubServer([deckResponse(2), asyncJobAccepted]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['notes.pdf']);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Preview cards Claude would write',
      })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Make the full AI deck' })
    );

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2)
    );
    const resent = callsTo(fetchMock, '/api/upload/file')[1][1]
      .body as FormData;
    expect(resent.getAll('claude-ai-flashcards')).toEqual(['true']);
    expect(resent.getAll('pdf-page-pairs')).toEqual(['false']);
  });

  it('sends nothing and records no choice when another account picks a structure for the kept file', async () => {
    const fetchMock = stubServer([
      jsonAnswer(400, {
        ...emptyExport,
        rescue: [{ rule: 'heading', cards: 2 }],
      }),
    ]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['notes.html']);
    const pick = await screen.findByRole('button', {
      name: 'Make 2 cards from the headings',
    });

    signInElsewhere();
    fireEvent.click(pick);
    await settle();

    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
    expect(eventsNamed('upload_rescue_chosen')).toEqual([]);
  });

  it('sends nothing, records no answer and remembers nothing when another account answers the PDF question for the kept file', async () => {
    const fetchMock = stubServer([pdfQuestion]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['scan.pdf']);
    const answer = await screen.findByRole('button', {
      name: 'One card per page',
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Remember my choice on this device',
      })
    );

    signInElsewhere();
    fireEvent.click(answer);
    await settle();

    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
    expect(eventsNamed('pdf_fallback_chosen')).toEqual([]);
    expect(globalThis.localStorage.getItem('pdf-fallback')).toBeNull();
  });

  it("sends a visitor's file again without AI from the preview's Continue without AI", async () => {
    setUserLocals(signedOutWithAiPreview);
    const fetchMock = stubServer([
      jsonAnswer(200, {
        kind: 'ai_preview',
        cards: [{ front: 'What does the Krebs cycle make?', back: 'ATP' }],
      }),
      deckResponse(12),
    ]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn />
    );
    await submitFiles(container, ['lecture.pdf']);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Continue without AI' })
    );

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2)
    );
    const resent = callsTo(fetchMock, '/api/upload/file')[1][1]
      .body as FormData;
    expect(resent.getAll('claude-ai-flashcards')).toEqual(['false']);
    expect((resent.get('pakker') as File).name).toBe('lecture.pdf');
  });

  it("sends nothing when another account continues without AI from a visitor's preview", async () => {
    setUserLocals(signedOutWithAiPreview);
    const fetchMock = stubServer([
      jsonAnswer(200, {
        kind: 'ai_preview',
        cards: [{ front: 'What does the Krebs cycle make?', back: 'ATP' }],
      }),
    ]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn />
    );
    await submitFiles(container, ['lecture.pdf']);
    const withoutAi = await screen.findByRole('button', {
      name: 'Continue without AI',
    });

    signInElsewhere();
    fireEvent.click(withoutAi);
    await settle();

    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
  });

  it('sends nothing when another account taps Try again for the kept file', async () => {
    const fetchMock = stubServer([networkDrop]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    const retry = await screen.findByRole('button', { name: 'Try again' });

    signInElsewhere();
    fireEvent.click(retry);
    await settle();

    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
  });

  it('offers no rebuild without a signed-in account, even when the locals read as paying', async () => {
    setUserLocals(payingWithoutAccount);
    stubServer([deckResponse(64)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);

    await screen.findByRole('button', { name: 'Make another deck' });
    await settle();
    expect(screen.queryByText(OFFER)).toBeNull();
    expect(shownEvents()).toEqual([]);
  });

  it('offers no rebuild to a paying account whose deck holds cards back', async () => {
    stubServer([
      deckResponse(42, { 'X-Cards-Held-Back': '300', 'X-Held-For-Plan': '1' }),
    ]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);

    expect(
      await screen.findByText('This deck has 42 of 342 cards')
    ).toBeInTheDocument();
    await settle();
    expect(screen.queryByText(OFFER)).toBeNull();
    expect(shownEvents()).toEqual([]);
  });

  it.each([
    ['a 64-card PDF', 'lecture.pdf', 64, 'pdf'],
    ['a 2-card .pptx, which the preview cannot read', 'slides.pptx', 2, 'pptx'],
  ])(
    'offers the rebuild with the thin-deck offer flag on for %s',
    async (_deck, filename, cards, format) => {
      setUserLocals(passHolderWithThinDeckOffer);
      stubServer([deckResponse(cards)]);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      await submitFiles(container, [filename]);

      expect(await screen.findByText(OFFER)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', {
          name: 'Preview cards Claude would write',
        })
      ).toBeNull();
      expect(shownEvents()).toEqual([['upload_ai_rebuild_shown', { format }]]);
    }
  );

  it.each([3, 8])(
    'leaves a %i-card PDF of 200 KB to the Claude preview offer with the thin-deck offer flag on',
    async (cards) => {
      setUserLocals(passHolderWithThinDeckOffer);
      stubServer([deckResponse(cards)]);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      await submitFiles(container, [
        new File([new Uint8Array(200 * 1024)], 'lecture.pdf'),
      ]);

      expect(
        await screen.findByRole('button', {
          name: 'Preview cards Claude would write',
        })
      ).toBeInTheDocument();
      await settle();
      expect(screen.queryByText(OFFER)).toBeNull();
      expect(shownEvents()).toEqual([]);
    }
  );

  it('offers no rebuild on the sample deck that follows a PDF, which the click would send again', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/ai/credits') {
        return Promise.resolve(creditsResponse(1347));
      }
      if (url === '/api/upload/file') {
        return Promise.resolve(deckResponse(64));
      }
      if (url === '/api/upload/sample') {
        return Promise.resolve(deckResponse(8));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} sample />
    );
    await submitFiles(container, ['lecture.pdf']);
    expect(await screen.findByText(OFFER)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Make another deck' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try a sample' }));
    });

    expect(
      await screen.findByRole('button', { name: 'Convert your own file' })
    ).toBeInTheDocument();
    await settle();
    expect(callsTo(fetchMock, '/api/upload/sample')).toHaveLength(1);
    expect(screen.queryByText(OFFER)).toBeNull();
    expect(shownEvents()).toHaveLength(1);
  });

  it('applies the AI choice on screen when Try again follows a dropped Continue without AI', async () => {
    setUserLocals(signedOutWithAiPreview);
    const fetchMock = stubServer([
      jsonAnswer(200, {
        kind: 'ai_preview',
        cards: [{ front: 'What does the Krebs cycle make?', back: 'ATP' }],
      }),
      networkDrop,
      deckResponse(12),
    ]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn />
    );
    await submitFiles(container, ['lecture.pdf']);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Continue without AI' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(3)
    );
    const retried = callsTo(fetchMock, '/api/upload/file')[2][1]
      .body as FormData;
    expect(retried.getAll('claude-ai-flashcards')).toEqual(['true']);
  });

  it('sends Claude on when Try again follows turning Claude on after a dropped upload', async () => {
    stubLeavingPage();
    const fetchMock = stubServer([networkDrop, asyncJobAccepted]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['lecture.pdf']);
    await screen.findByRole('button', { name: 'Try again' });

    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    rerenderWithAi(true);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2)
    );
    const retried = callsTo(fetchMock, '/api/upload/file')[1][1]
      .body as FormData;
    expect(retried.getAll('claude-ai-flashcards')).toEqual(['true']);
  });

  async function saveInterruptedUpload(overrides: Partial<PendingUpload> = {}) {
    await getPendingUploadStore().save({
      files: [new File(['x'], 'lecture.pdf', { type: 'application/pdf' })],
      filename: 'lecture.pdf',
      sizeBytes: 1,
      submittedAt: Date.now(),
      recoveryToken: null,
      ownerId: 7,
      pdfPageRange: null,
      aiFlag: 'false',
      ...overrides,
    });
  }

  const whoTriesAgain = [
    { who: 'the account that sent it', otherAccount: false, uploads: 2 },
    { who: 'another account', otherAccount: true, uploads: 1 },
  ];

  it.each(whoTriesAgain)(
    'resends a file resumed from the Continue banner on Try again only for the account that sent it: $who',
    async ({ otherAccount, uploads }) => {
      await saveInterruptedUpload();
      const fetchMock = stubServer([networkDrop, deckResponse(64)]);
      renderUploadForm(<UploadForm setErrorMessage={vi.fn()} aiOn={false} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
      const retry = await screen.findByRole('button', { name: 'Try again' });

      if (otherAccount) signInElsewhere();
      fireEvent.click(retry);
      await settle();

      await waitFor(() =>
        expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(uploads)
      );
    }
  );

  it.each(whoTriesAgain)(
    'resends the file sent again after the Day Pass return on Try again only for the account that sent it: $who',
    async ({ otherAccount, uploads }) => {
      vi.stubGlobal('location', {
        search: '?from=pass&session_id=cs_thin',
        href: 'http://localhost/upload?from=pass&session_id=cs_thin',
        origin: 'http://localhost',
      });
      markThinDeckResume();
      await saveInterruptedUpload({ aiFlag: 'true', claudeResend: true });
      const fetchMock = stubServer([networkDrop, deckResponse(64)]);
      renderUploadForm(<UploadForm setErrorMessage={vi.fn()} aiOn={false} />);
      const retry = await screen.findByRole('button', { name: 'Try again' });

      if (otherAccount) signInElsewhere();
      fireEvent.click(retry);
      await settle();

      await waitFor(() =>
        expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(uploads)
      );
    }
  );

  it.each(whoTriesAgain)(
    'resends a file handed over from Print or CSV on Try again only for the account that sent it: $who',
    async ({ otherAccount, uploads }) => {
      const fetchMock = stubServer([networkDrop, deckResponse(40)]);
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <MemoryRouter
          initialEntries={[
            {
              pathname: '/upload',
              state: {
                handoffFile: new File(['# notes'], 'notes.zip', {
                  type: 'application/zip',
                }),
              },
            },
          ]}
        >
          <QueryClientProvider client={queryClient}>
            <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
          </QueryClientProvider>
        </MemoryRouter>
      );
      const retry = await screen.findByRole('button', { name: 'Try again' });

      if (otherAccount) signInElsewhere();
      fireEvent.click(retry);
      await settle();

      await waitFor(() =>
        expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(uploads)
      );
    }
  );

  it('resumes an interrupted rebuild with Claude on and two pages make one card off', async () => {
    stubLeavingPage();
    const fetchMock = stubServer([
      deckResponse(64),
      new Promise<never>(() => {}),
      asyncJobAccepted,
    ]);
    const first = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(first.container, ['lecture.pdf']);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Rebuild with Claude' })
    );
    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2)
    );
    first.unmount();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} aiOn={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(3)
    );
    const resumed = callsTo(fetchMock, '/api/upload/file')[2][1]
      .body as FormData;
    expect(resumed.getAll('claude-ai-flashcards')).toEqual(['true']);
    expect(resumed.getAll('pdf-page-pairs')).toEqual(['false']);
  });

  it('holds a Claude rebuild and says why when the account cannot be read', async () => {
    const fetchMock = stubServer([deckResponse(64)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    const rebuild = await screen.findByRole('button', {
      name: 'Rebuild with Claude',
    });

    failAccountRead();
    fireEvent.click(rebuild);

    expect(await screen.findByText(UNCONFIRMED)).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Rebuild with Claude' })
    ).toBeEnabled();
    expect(eventsNamed('upload_ai_rebuild_clicked')).toEqual([]);
  });

  it('holds a Claude rebuild and says why when reading the account takes longer than two seconds', async () => {
    const fetchMock = stubServer([deckResponse(64)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    const rebuild = await screen.findByRole('button', {
      name: 'Rebuild with Claude',
    });

    readLocalsAgain.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(rebuild);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(await screen.findByText(UNCONFIRMED)).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
  });

  it('still sends a structure choice under the account the page shows when the account cannot be read', async () => {
    const fetchMock = stubServer([
      jsonAnswer(400, {
        ...emptyExport,
        rescue: [{ rule: 'heading', cards: 2 }],
      }),
      deckResponse(2),
    ]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['notes.html']);
    const pick = await screen.findByRole('button', {
      name: 'Make 2 cards from the headings',
    });

    failAccountRead();
    fireEvent.click(pick);

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2)
    );
  });

  it('says it is checking who is signed in on the rebuild as soon as it is tapped, and disables it until the read answers', async () => {
    stubLeavingPage();
    const fetchMock = stubServer([deckResponse(64), asyncJobAccepted]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    const rebuild = await screen.findByRole('button', {
      name: 'Rebuild with Claude',
    });

    const release = holdAccountRead();
    fireEvent.click(rebuild);

    const checking = await screen.findByRole('button', { name: CHECKING });
    expect(checking).toBeDisabled();
    expect(checking).toHaveAttribute('aria-busy', 'true');
    await act(async () => release());
    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2)
    );
  });

  it('sends nothing when Make another deck is chosen while the account is read again', async () => {
    const fetchMock = stubServer([deckResponse(64)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    const rebuild = await screen.findByRole('button', {
      name: 'Rebuild with Claude',
    });

    const release = holdAccountRead();
    fireEvent.click(rebuild);
    fireEvent.click(screen.getByRole('button', { name: 'Make another deck' }));
    await act(async () => release());
    await settle();

    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
  });

  it('puts a line saying why in place of the structure choices once another account signs in on this page', async () => {
    stubServer([
      jsonAnswer(400, {
        ...emptyExport,
        rescue: [{ rule: 'heading', cards: 2 }],
      }),
    ]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['notes.html']);
    await screen.findByRole('button', {
      name: 'Make 2 cards from the headings',
    });

    setUserLocals(otherPassHolder);
    rerenderWithAi(false);

    expect(
      screen.getByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Make 2 cards from the headings' })
    ).toBeNull();
  });

  it('puts a line saying why in place of Try again once another account signs in on this page', async () => {
    stubServer([networkDrop]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['lecture.pdf']);
    await screen.findByRole('button', { name: 'Try again' });

    setUserLocals(otherPassHolder);
    rerenderWithAi(false);

    expect(
      screen.getByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it("frees a visitor's AI preview once they sign in from another tab", async () => {
    setUserLocals(signedOutWithAiPreview);
    stubServer([
      jsonAnswer(200, {
        kind: 'ai_preview',
        cards: [{ front: 'What does the Krebs cycle make?', back: 'ATP' }],
      }),
    ]);
    const { container, rerenderWithAi } = renderRebuildForm(true);
    await submitFiles(container, ['lecture.pdf']);
    await screen.findByRole('button', { name: 'Continue without AI' });

    setUserLocals(otherPassHolder);
    rerenderWithAi(true);

    expect(
      screen.getByText(SIGNED_IN_LINE, { selector: 'p' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Continue without AI' })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Choose the file again' })
    ).toBeInTheDocument();
  });

  it('says the session signed out once the account that sent the file signs out on this page', async () => {
    stubServer([deckResponse(64)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['lecture.pdf']);
    expect(await screen.findByText(OFFER)).toBeInTheDocument();

    setUserLocals(signedOut);
    rerenderWithAi(false);

    expect(
      screen.getByText(SIGNED_OUT_LINE, { selector: 'p' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?redirect=/upload'
    );
  });

  it('opens the file picker on a fresh drop zone from Choose the file again', async () => {
    stubServer([deckResponse(64)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['lecture.pdf']);
    expect(await screen.findByText(OFFER)).toBeInTheDocument();
    setUserLocals(otherPassHolder);
    rerenderWithAi(false);
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const pickerOpened = vi.fn();
    input.addEventListener('click', pickerOpened);

    const labelLeftAlone = fireEvent.click(
      screen.getByRole('button', { name: 'Choose the file again' })
    );

    expect(pickerOpened).toHaveBeenCalledTimes(1);
    expect(labelLeftAlone).toBe(false);
    expect(
      screen.queryByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Make another deck' })
    ).toBeNull();
  });

  it('never gives a file the server converted for one account to the account that signs in next, after the first account read failed', async () => {
    accountReadFailed(otherPassHolder);
    const fetchMock = stubServer([
      jsonAnswer(
        400,
        { ...emptyExport, rescue: [{ rule: 'heading', cards: 2 }] },
        sentBy('7')
      ),
    ]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['notes.html']);
    await settle();
    rerenderWithAi(false);

    expect(
      await screen.findByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Make 2 cards from the headings' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Make cards with AI' })
    ).toBeNull();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
  });

  it('holds Try again for a file whose upload got no answer while the page had no account data, and says why', async () => {
    accountReadFailed(passHolder);
    const fetchMock = stubServer([networkDrop, deckResponse(64)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByText(SENDER_UNKNOWN, { selector: 'p' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose the file again' })
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
  });

  it('keeps the saved sender of the file resumed after the Day Pass, when the next account read finds another account', async () => {
    vi.stubGlobal('location', {
      search: '?from=pass&session_id=cs_thin',
      href: 'http://localhost/upload?from=pass&session_id=cs_thin',
      origin: 'http://localhost',
    });
    markThinDeckResume();
    await saveInterruptedUpload({
      ownerId: null,
      aiFlag: 'true',
      claudeResend: true,
    });
    setUserLocals(passHolderWithoutAccount);
    const fetchMock = stubServer([
      jsonAnswer(
        409,
        { code: 'choose_pdf_mode', reason: 'no_text', page_count: 14 },
        sentBy('none')
      ),
    ]);
    const { rerenderWithAi } = renderRebuildForm(false);

    expect((await nthUpload(fetchMock, 1)).getAll('kept-owner')).toEqual([
      'none',
    ]);
    await screen.findByRole('button', { name: 'One card per page' });
    setUserLocals(otherPassHolder);
    rerenderWithAi(false);

    expect(
      await screen.findByText(SIGNED_IN_LINE, { selector: 'p' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'One card per page' })
    ).toBeNull();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
  });

  it.each([
    [
      'an empty deck',
      '7',
      async () => {
        accountReadFailed(passHolder);
        const fetchMock = stubServer([
          jsonAnswer(
            400,
            { ...emptyExport, rescue: [{ rule: 'heading', cards: 2 }] },
            sentBy('7')
          ),
          deckResponse(2),
        ]);
        const { container } = renderUploadForm(
          <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
        );
        await submitFiles(container, ['notes.html']);
        fireEvent.click(
          await screen.findByRole('button', {
            name: 'Make 2 cards from the headings',
          })
        );
        return nthUpload(fetchMock, 2);
      },
    ],
    [
      'the PDF question',
      '7',
      async () => {
        accountReadFailed(passHolder);
        const fetchMock = stubServer([
          jsonAnswer(
            409,
            { code: 'choose_pdf_mode', reason: 'no_text', page_count: 14 },
            sentBy('7')
          ),
          deckResponse(14),
        ]);
        const { container } = renderUploadForm(
          <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
        );
        await submitFiles(container, ['scan.pdf']);
        fireEvent.click(
          await screen.findByRole('button', { name: 'One card per page' })
        );
        return nthUpload(fetchMock, 2);
      },
    ],
    [
      'a deck',
      '7',
      async () => {
        accountReadFailed(passHolder);
        stubLeavingPage();
        const fetchMock = stubServer([
          deckResponse(64, sentBy('7')),
          asyncJobAccepted,
        ]);
        const { container, rerenderWithAi } = renderRebuildForm(false);
        await submitFiles(container, ['lecture.pdf']);
        await screen.findByRole('button', { name: 'Make another deck' });
        await settle();
        rerenderWithAi(false);
        fireEvent.click(
          await screen.findByRole('button', { name: 'Rebuild with Claude' })
        );
        return nthUpload(fetchMock, 2);
      },
    ],
    [
      "a visitor's AI preview",
      'none',
      async () => {
        accountReadFailed(signedOutWithAiPreview);
        const fetchMock = stubServer([
          jsonAnswer(
            200,
            {
              kind: 'ai_preview',
              cards: [
                { front: 'What does the Krebs cycle make?', back: 'ATP' },
              ],
            },
            sentBy('none')
          ),
          deckResponse(3),
        ]);
        const { container } = renderUploadForm(
          <UploadForm setErrorMessage={vi.fn()} aiOn />
        );
        await submitFiles(container, ['lecture.pdf']);
        fireEvent.click(
          await screen.findByRole('button', { name: 'Continue without AI' })
        );
        return nthUpload(fetchMock, 2);
      },
    ],
    [
      'a locked PDF',
      '7',
      async () => {
        accountReadFailed(passHolder);
        const fetchMock = vi.fn((url: string) => {
          if (url === '/api/ai/credits') {
            return Promise.resolve(creditsResponse(1347));
          }
          if (url === '/api/upload/file') {
            return Promise.resolve({
              ...needsPassword,
              headers: new Headers({
                'Content-Type': 'application/json',
                ...sentBy('7'),
              }),
            });
          }
          if (url === '/api/upload/retry-with-credential') {
            return Promise.resolve(deckResponse(5));
          }
          return Promise.resolve(new Response(null, { status: 204 }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const { container } = renderUploadForm(
          <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
        );
        await submitFiles(container, ['locked.pdf']);
        await unlockWithPassword();
        return nthUpload(fetchMock, 1, '/api/upload/retry-with-credential');
      },
    ],
  ] as Array<[string, string, () => Promise<FormData>]>)(
    'takes the sender from the server on %s, and sends the kept file back as it',
    async (_kind, owner, resend) => {
      expect((await resend()).getAll('kept-owner')).toEqual([owner]);
    }
  );

  const refusedFor = (signedIn: boolean) =>
    jsonAnswer(409, {
      code: 'owner_changed',
      message:
        'You switched accounts since this file was sent, so nothing was converted. Choose the file again.',
      signed_in: signedIn,
    });
  const ownerChanged = refusedFor(true);

  // The account read after a refusal still answers with the account the page
  // already shows, so only the server's answer can say what changed.
  function readStillShowsTheOldAccount() {
    readLocalsAgain.mockResolvedValue(answered(passHolder));
  }

  const otherFreeSignedIn = {
    user: { id: 11, email: 'other-free@example.com' },
    locals: { owner: 11, patreon: false, subscriber: false },
    features: {},
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  async function nthUpload(
    fetchMock: Mock,
    n: number,
    url = '/api/upload/file'
  ): Promise<FormData> {
    await waitFor(() =>
      expect(callsTo(fetchMock, url).length).toBeGreaterThanOrEqual(n)
    );
    return callsTo(fetchMock, url)[n - 1][1].body as FormData;
  }

  async function submitAndTap(
    files: string[],
    answers: UploadAnswer[],
    button: string,
    aiOn = false
  ): Promise<Mock> {
    const fetchMock = stubServer(answers);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={aiOn} />
    );
    await submitFiles(container, files);
    fireEvent.click(await screen.findByRole('button', { name: button }));
    return fetchMock;
  }

  function dropOnPage(dataTransfer: unknown) {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    act(() => {
      document.body.dispatchEvent(event);
    });
  }

  const visitorPreview = jsonAnswer(200, {
    kind: 'ai_preview',
    cards: [{ front: 'What does the Krebs cycle make?', back: 'ATP' }],
  });

  const resendsOfKeptFiles: Array<[string, string, () => Promise<FormData>]> = [
    [
      'Rebuild with Claude',
      '7',
      async () => {
        stubLeavingPage();
        const fetchMock = await submitAndTap(
          ['lecture.pdf'],
          [deckResponse(64), asyncJobAccepted],
          'Rebuild with Claude'
        );
        return nthUpload(fetchMock, 2);
      },
    ],
    [
      "the empty state's Make cards with AI",
      '7',
      async () => {
        stubLeavingPage();
        const fetchMock = await submitAndTap(
          ['notes.html'],
          [jsonAnswer(400, emptyExport), asyncJobAccepted],
          'Make cards with AI'
        );
        return nthUpload(fetchMock, 2);
      },
    ],
    [
      "the PDF question's Make cards with AI",
      '7',
      async () => {
        stubLeavingPage();
        const fetchMock = await submitAndTap(
          ['lecture.pdf'],
          [pdfQuestion, asyncJobAccepted],
          'Make cards with AI'
        );
        return nthUpload(fetchMock, 2);
      },
    ],
    [
      'Make the full AI deck',
      '7',
      async () => {
        setUserLocals(passHolderWithThinDeckOffer);
        withThinDeckPreview();
        stubLeavingPage();
        const fetchMock = await submitAndTap(
          ['notes.pdf'],
          [deckResponse(2), asyncJobAccepted],
          'Preview cards Claude would write'
        );
        fireEvent.click(
          await screen.findByRole('button', {
            name: 'Make the full AI deck',
          })
        );
        return nthUpload(fetchMock, 2);
      },
    ],
    [
      'a structure choice',
      '7',
      async () => {
        const fetchMock = await submitAndTap(
          ['notes.html'],
          [
            jsonAnswer(400, {
              ...emptyExport,
              rescue: [{ rule: 'heading', cards: 2 }],
            }),
            deckResponse(2),
          ],
          'Make 2 cards from the headings'
        );
        return nthUpload(fetchMock, 2);
      },
    ],
    [
      'a PDF answer',
      '7',
      async () => {
        const fetchMock = await submitAndTap(
          ['lecture.pdf'],
          [pdfQuestion, deckResponse(14)],
          'One card per page'
        );
        return nthUpload(fetchMock, 2);
      },
    ],
    [
      'Try again',
      '7',
      async () => {
        const fetchMock = await submitAndTap(
          ['lecture.pdf'],
          [networkDrop, deckResponse(64)],
          'Try again'
        );
        return nthUpload(fetchMock, 2);
      },
    ],
    [
      "a visitor's Continue without AI",
      'none',
      async () => {
        setUserLocals(signedOutWithAiPreview);
        const fetchMock = await submitAndTap(
          ['lecture.pdf'],
          [visitorPreview, deckResponse(3)],
          'Continue without AI',
          true
        );
        return nthUpload(fetchMock, 2);
      },
    ],
    [
      'the Continue banner',
      '7',
      async () => {
        await saveInterruptedUpload();
        const fetchMock = stubServer([deckResponse(64)]);
        renderUploadForm(<UploadForm setErrorMessage={vi.fn()} aiOn={false} />);
        fireEvent.click(
          await screen.findByRole('button', { name: 'Continue' })
        );
        return nthUpload(fetchMock, 1);
      },
    ],
    [
      'a password unlock',
      '7',
      async () => {
        const fetchMock = stubLockedPdfServer(5);
        const { container } = renderUploadForm(
          <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
        );
        await submitFiles(container, ['locked.pdf']);
        await unlockWithPassword();
        return nthUpload(fetchMock, 1, '/api/upload/retry-with-credential');
      },
    ],
  ];

  it.each(resendsOfKeptFiles)(
    'names the account that sent the file on %s',
    async (_path, owner, resend) => {
      expect((await resend()).getAll('kept-owner')).toEqual([owner]);
    }
  );

  it('names no account on a fresh upload', async () => {
    const fetchMock = stubServer([deckResponse(64)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);

    expect((await nthUpload(fetchMock, 1)).has('kept-owner')).toBe(false);
  });

  it('names no account on a file handed over from Print or CSV', async () => {
    const fetchMock = stubServer([deckResponse(40)]);
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/upload',
            state: {
              handoffFile: new File(['# notes'], 'notes.zip', {
                type: 'application/zip',
              }),
            },
          },
        ]}
      >
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
        </QueryClientProvider>
      </MemoryRouter>
    );

    expect((await nthUpload(fetchMock, 1)).has('kept-owner')).toBe(false);
  });

  it('tries a dropped Claude upload again under the account the page shows when the read fails, and says the session changed once the server refuses it', async () => {
    globalThis.localStorage.setItem('claude-ai-flashcards', 'true');
    const fetchMock = stubServer([networkDrop, ownerChanged]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn />
    );
    await submitFiles(container, ['lecture.pdf']);
    const retry = await screen.findByRole('button', { name: 'Try again' });

    readLocalsAgain
      .mockResolvedValueOnce({
        data: passHolder,
        status: 'error',
        isError: true,
      })
      .mockImplementationOnce(async () => {
        setUserLocals(otherPassHolder);
        return answered(otherPassHolder);
      });
    fireEvent.click(retry);

    const resent = await nthUpload(fetchMock, 2);
    expect(resent.getAll('claude-ai-flashcards')).toEqual(['true']);
    expect(resent.getAll('kept-owner')).toEqual(['7']);
    expect(
      await screen.findByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText('Talk it through instead')).toBeNull();
  });

  it('says the visitor is signed in now when the server refuses a file they sent signed out', async () => {
    setUserLocals(signedOutWithAiPreview);
    const fetchMock = stubServer([visitorPreview, ownerChanged]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn />
    );
    await submitFiles(container, ['lecture.pdf']);
    const continueWithoutAi = await screen.findByRole('button', {
      name: 'Continue without AI',
    });

    readLocalsAgain
      .mockResolvedValueOnce({
        data: signedOutWithAiPreview,
        status: 'error',
        isError: true,
      })
      .mockImplementationOnce(async () => {
        setUserLocals(otherPassHolder);
        return answered(otherPassHolder);
      });
    fireEvent.click(continueWithoutAi);

    expect((await nthUpload(fetchMock, 2)).getAll('kept-owner')).toEqual([
      'none',
    ]);
    expect(
      await screen.findByText(SIGNED_IN_LINE, { selector: 'p' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('says the session signed out, from the server answer alone, when it refuses a password unlock', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/ai/credits') {
        return Promise.resolve(creditsResponse(1347));
      }
      if (url === '/api/upload/file') return Promise.resolve(needsPassword);
      if (url === '/api/upload/retry-with-credential') {
        return Promise.resolve(refusedFor(false));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['locked.pdf']);

    readStillShowsTheOldAccount();
    await unlockWithPassword();

    expect(
      await screen.findByText(SIGNED_OUT_LINE, { selector: 'p' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?redirect=/upload'
    );
    expect(
      screen.queryByText(
        "That didn't open the file. Check for typos and try again."
      )
    ).toBeNull();
  });

  it.each([
    [true, OTHER_ACCOUNT_LINE],
    [false, SIGNED_OUT_LINE],
  ])(
    'says what changed at once, from the server, when it refuses a resend (signed in: %s), and announces it',
    async (signedIn, line) => {
      const fetchMock = stubServer([
        jsonAnswer(400, {
          ...emptyExport,
          rescue: [{ rule: 'heading', cards: 2 }],
        }),
        refusedFor(signedIn),
      ]);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      await submitFiles(container, ['notes.html']);
      const pick = await screen.findByRole('button', {
        name: 'Make 2 cards from the headings',
      });

      readStillShowsTheOldAccount();
      fireEvent.click(pick);

      await waitFor(() =>
        expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2)
      );
      expect(
        await screen.findByText(line, { selector: 'p' })
      ).toBeInTheDocument();
      expect(container.querySelector('output')?.textContent).toBe(line);
      expect(screen.queryByText('Something went wrong')).toBeNull();
    }
  );

  it("holds the empty state's Make cards with AI and says why when the account cannot be read", async () => {
    const fetchMock = stubServer([jsonAnswer(400, emptyExport)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['notes.html']);
    const make = await screen.findByRole('button', {
      name: 'Make cards with AI',
    });

    failAccountRead();
    fireEvent.click(make);

    expect(await screen.findByText(UNCONFIRMED)).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
    expect(eventsNamed('upload_ai_rescue_clicked')).toEqual([]);
  });

  it("holds the PDF question's Make cards with AI and says why when the account cannot be read", async () => {
    const fetchMock = stubServer([pdfQuestion]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    const make = await screen.findByRole('button', {
      name: 'Make cards with AI',
    });

    failAccountRead();
    fireEvent.click(make);

    expect(await screen.findByText(UNCONFIRMED)).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
  });

  it('holds Try again of a dropped rebuild and says why when the account cannot be read', async () => {
    const fetchMock = stubServer([deckResponse(64), networkDrop]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Rebuild with Claude' })
    );
    const retry = await screen.findByRole('button', { name: 'Try again' });

    failAccountRead();
    fireEvent.click(retry);

    expect(await screen.findByText(UNCONFIRMED)).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2);
  });

  it('holds Make the full AI deck and records no tap when the account cannot be read', async () => {
    setUserLocals(passHolderWithThinDeckOffer);
    withThinDeckPreview();
    const fetchMock = stubServer([deckResponse(2)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['notes.pdf']);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Preview cards Claude would write',
      })
    );
    const fullDeck = await screen.findByRole('button', {
      name: 'Make the full AI deck',
    });

    failAccountRead();
    fireEvent.click(fullDeck);

    expect(await screen.findByText(UNCONFIRMED)).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
    expect(eventsNamed('thin_deck_ai_unlock_clicked')).toEqual([]);
  });

  it.each([
    ['Try again', 'lecture.pdf', networkDrop, 'Try again', []],
    [
      'a PDF answer',
      'lecture.pdf',
      pdfQuestion,
      'One card per page',
      ['Two pages per card', 'Make cards with AI'],
    ],
    [
      'a structure choice',
      'notes.html',
      jsonAnswer(400, {
        ...emptyExport,
        rescue: [{ rule: 'heading', cards: 2 }],
      }),
      'Make 2 cards from the headings',
      ['Make cards with AI'],
    ],
    [
      "the empty state's Make cards with AI",
      'notes.html',
      jsonAnswer(400, emptyExport),
      'Make cards with AI',
      [],
    ],
    [
      "the PDF question's Make cards with AI",
      'lecture.pdf',
      pdfQuestion,
      'Make cards with AI',
      ['One card per page', 'Two pages per card'],
    ],
  ] as Array<[string, string, UploadAnswer, string, string[]]>)(
    'says it is checking who is signed in on %s and holds every resend button until the read answers',
    async (_path, file, answer, tapped, others) => {
      stubServer([answer]);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      await submitFiles(container, [file]);
      const button = await screen.findByRole('button', { name: tapped });

      holdAccountRead();
      fireEvent.click(button);

      const checking = await screen.findByRole('button', { name: CHECKING });
      expect(checking).toBeDisabled();
      expect(checking).toHaveAttribute('aria-busy', 'true');
      for (const other of others) {
        expect(screen.getByRole('button', { name: other })).toBeDisabled();
      }
    }
  );

  it('keeps Claude on when Try again follows a dropped answer to the question a rebuild raised', async () => {
    stubLeavingPage();
    const fetchMock = stubServer([
      deckResponse(64),
      pdfQuestion,
      networkDrop,
      asyncJobAccepted,
    ]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Rebuild with Claude' })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'One card per page' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    const retried = await nthUpload(fetchMock, 4);
    expect(retried.getAll('claude-ai-flashcards')).toEqual(['true']);
    expect(retried.getAll('pdf-page-pairs')).toEqual(['false']);
  });

  it('sends nothing from a rebuild whose account check is still running when a folder is dropped', async () => {
    const fetchMock = stubServer([deckResponse(64)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    const rebuild = await screen.findByRole('button', {
      name: 'Rebuild with Claude',
    });

    const release = holdAccountRead();
    fireEvent.click(rebuild);
    dropOnPage({
      items: [
        {
          webkitGetAsEntry: () => ({
            isDirectory: true,
            isFile: false,
            name: 'notes',
          }),
        },
      ],
      files: [],
    });
    await act(async () => release());
    await settle();

    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
    expect(eventsNamed('upload_ai_rebuild_clicked')).toEqual([]);
  });

  it('sends nothing from a rebuild whose account check is still running when a file is dropped', async () => {
    const fetchMock = stubServer([deckResponse(64)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['lecture.pdf']);
    const rebuild = await screen.findByRole('button', {
      name: 'Rebuild with Claude',
    });
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [],
      writable: true,
      configurable: true,
    });
    const stillReading = new File(['x'], 'notes.zip');
    Object.defineProperty(stillReading, 'arrayBuffer', {
      value: () => new Promise(() => {}),
    });

    const release = holdAccountRead();
    fireEvent.click(rebuild);
    dropOnPage({
      items: [
        {
          webkitGetAsEntry: () => ({
            isDirectory: false,
            isFile: true,
            name: 'notes.zip',
          }),
        },
      ],
      files: [stillReading],
    });
    await act(async () => release());
    await settle();

    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
    expect(eventsNamed('upload_ai_rebuild_clicked')).toEqual([]);
  });

  it('shows the preview gate, not a sign-in line, for a Dropbox file picked after the account that sent a local file signed out', async () => {
    const previousKey = process.env.REACT_APP_DROPBOX_APP_KEY;
    process.env.REACT_APP_DROPBOX_APP_KEY = 'test-key';
    (window as unknown as { Dropbox?: unknown }).Dropbox = {
      choose: ({ success }: { success: (files: unknown[]) => void }) => {
        success([
          {
            id: 'id:9',
            name: 'lecture.pdf',
            bytes: 100,
            icon: 'page',
            isDir: false,
            link: 'https://dl.dropboxusercontent.com/x/lecture.pdf',
            linkType: 'direct',
          },
        ]);
      },
    };
    try {
      const fetchMock = stubServer([deckResponse(64), visitorPreview]);
      const { container, rerenderWithAi } = renderRebuildForm(false);
      await submitFiles(container, ['lecture.pdf']);
      expect(await screen.findByText(OFFER)).toBeInTheDocument();

      setUserLocals(signedOutWithAiPreview);
      rerenderWithAi(true);
      fireEvent.click(
        screen.getByRole('button', { name: 'Choose the file again' })
      );
      const dropbox = container.querySelector(
        'button[aria-label="Choose from Dropbox"]'
      ) as HTMLButtonElement;
      await act(async () => {
        dropbox.click();
      });

      await waitFor(() =>
        expect(callsTo(fetchMock, '/api/upload/dropbox')).toHaveLength(1)
      );
      expect(
        await screen.findByRole('button', { name: 'Continue without AI' })
      ).toBeInTheDocument();
      expect(screen.queryByText(SIGNED_OUT_LINE, { selector: 'p' })).toBeNull();
    } finally {
      delete (window as unknown as { Dropbox?: unknown }).Dropbox;
      process.env.REACT_APP_DROPBOX_APP_KEY = previousKey;
    }
  });

  it("sends nothing when another free account picks a structure for a free account's kept file", async () => {
    setUserLocals(freeSignedIn);
    const fetchMock = stubServer([
      jsonAnswer(400, {
        ...emptyExport,
        rescue: [{ rule: 'heading', cards: 2 }],
      }),
    ]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['notes.html']);
    const pick = await screen.findByRole('button', {
      name: 'Make 2 cards from the headings',
    });

    signInElsewhere(otherFreeSignedIn);
    fireEvent.click(pick);
    await settle();

    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
    expect(eventsNamed('upload_rescue_chosen')).toEqual([]);
  });

  it('opens the file picker from the preview gate once the session there changed', async () => {
    setUserLocals(signedOutWithAiPreview);
    stubServer([visitorPreview]);
    const { container, rerenderWithAi } = renderRebuildForm(true);
    await submitFiles(container, ['lecture.pdf']);
    await screen.findByRole('button', { name: 'Continue without AI' });
    setUserLocals(otherPassHolder);
    rerenderWithAi(true);
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const pickerOpened = vi.fn();
    input.addEventListener('click', pickerOpened);

    const labelLeftAlone = fireEvent.click(
      screen.getByRole('button', { name: 'Choose the file again' })
    );

    expect(pickerOpened).toHaveBeenCalledTimes(1);
    expect(labelLeftAlone).toBe(false);
  });

  it('shows no line under a deck that never had an offer once another account signs in', async () => {
    stubServer([deckResponse(40)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['notes.csv']);
    await screen.findByRole('button', { name: 'Make another deck' });

    setUserLocals(otherPassHolder);
    rerenderWithAi(false);

    expect(
      screen.queryByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Choose the file again' })
    ).toBeNull();
  });

  it('shows no line on an empty deck that offered nothing to send again once another account signs in', async () => {
    setUserLocals(freeSignedIn);
    stubServer([jsonAnswer(400, emptyExport)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['notes.html']);
    await screen.findByText('Get AI cards with a paid plan');

    setUserLocals(otherFreeSignedIn);
    rerenderWithAi(false);

    expect(
      screen.queryByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Choose the file again' })
    ).toBeNull();
  });

  it('resumes the file left for the Day Pass with Claude on and two pages make one card off, through the save made before checkout', async () => {
    const freeWithThinDeckOffer = {
      user: { id: 8, email: 'free@example.com' },
      locals: { owner: 8, patreon: false, subscriber: false },
      features: { thinDeckAiOffer: true },
    } as unknown as ReturnType<typeof useUserLocals>['data'];
    const passBuyer = {
      user: { id: 8, email: 'free@example.com' },
      locals: {
        owner: 8,
        patreon: false,
        subscriber: true,
        passKind: '24h',
      },
      features: { thinDeckAiOffer: true },
    } as unknown as ReturnType<typeof useUserLocals>['data'];
    globalThis.localStorage.setItem('pdf-page-pairs', 'true');
    setUserLocals(freeWithThinDeckOffer);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi
        .fn()
        .mockResolvedValue({ url: 'https://checkout.example/pass' }),
      getUploads: vi.fn().mockResolvedValue([]),
      getHeldDeck: vi.fn().mockResolvedValue(null),
      previewThinDeckAi: vi.fn().mockResolvedValue({
        kind: 'preview',
        cards: [{ front: 'What does the Krebs cycle make?', back: 'ATP' }],
      }),
    } as unknown as ReturnType<typeof get2ankiApi>);
    const leaving = stubLeavingPage();
    const fetchMock = stubServer([deckResponse(2), asyncJobAccepted]);
    const first = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(first.container, ['notes.pdf']);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Preview cards Claude would write',
      })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /Get every card: Day Pass/ })
    );
    await waitFor(() =>
      expect(leaving.href).toBe('https://checkout.example/pass')
    );
    first.unmount();

    vi.stubGlobal('location', {
      search: '?from=pass&session_id=cs_thin',
      href: 'http://localhost/upload?from=pass&session_id=cs_thin',
      origin: 'http://localhost',
    });
    setUserLocals(passBuyer);
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} aiOn={false} />);

    const resumed = await nthUpload(fetchMock, 2);
    expect(resumed.getAll('claude-ai-flashcards')).toEqual(['true']);
    expect(resumed.getAll('pdf-page-pairs')).toEqual(['false']);
    expect(resumed.getAll('kept-owner')).toEqual(['8']);
    expect(
      eventsNamed('thin_deck_ai_unlock_clicked').filter(
        ([, props]) => props?.plan === 'resumed'
      )
    ).toEqual([['thin_deck_ai_unlock_clicked', { plan: 'resumed' }]]);
    expect(eventsNamed('upload_submitted')).toContainEqual([
      'upload_submitted',
      expect.objectContaining({
        input_format: 'pdf',
        trigger: 'resume',
        retry: true,
      }),
    ]);
  });

  const passHolderWithoutAccount = {
    user: null,
    locals: { owner: 0, patreon: false, subscriber: true, passKind: '24h' },
    features: { thinDeckAiOffer: true },
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  const visitorWithThinDeckOffer = {
    user: null,
    locals: { owner: 0, patreon: false, subscriber: false },
    features: { thinDeckAiOffer: true },
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  async function openFullAiDeck(container: HTMLElement) {
    await submitFiles(container, ['notes.pdf']);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Preview cards Claude would write',
      })
    );
    return screen.findByRole('button', { name: 'Make the full AI deck' });
  }

  it("puts a line in place of the empty state's Make cards with AI once a free account signs in on this page", async () => {
    stubServer([jsonAnswer(400, emptyExport)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['notes.html']);
    await screen.findByRole('button', { name: 'Make cards with AI' });

    setUserLocals(otherFreeSignedIn);
    rerenderWithAi(false);

    expect(
      screen.getByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Get AI cards with a paid plan')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Make cards with AI' })
    ).toBeNull();
  });

  it("says it is checking who is signed in on the preview's Continue without AI, and holds it until the read answers", async () => {
    setUserLocals(signedOutWithAiPreview);
    stubServer([visitorPreview]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn />
    );
    await submitFiles(container, ['lecture.pdf']);
    const button = await screen.findByRole('button', {
      name: 'Continue without AI',
    });

    holdAccountRead();
    fireEvent.click(button);

    const checking = await screen.findByRole('button', { name: CHECKING });
    expect(checking).toBeDisabled();
    expect(checking).toHaveAttribute('aria-busy', 'true');
  });

  it('says it is checking who is signed in on Make the full AI deck, and holds it until the read answers', async () => {
    setUserLocals(passHolderWithThinDeckOffer);
    withThinDeckPreview();
    stubServer([deckResponse(2)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    const fullDeck = await openFullAiDeck(container);

    holdAccountRead();
    fireEvent.click(fullDeck);

    const checking = await screen.findByRole('button', { name: CHECKING });
    expect(checking).toBeDisabled();
    expect(checking).toHaveAttribute('aria-busy', 'true');
  });

  it("holds a signed-out Day Pass holder's answer to the PDF question Make the full AI deck raised, and says why, when the account cannot be read", async () => {
    setUserLocals(passHolderWithoutAccount);
    withThinDeckPreview();
    const fetchMock = stubServer([deckResponse(2), pdfQuestion]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    fireEvent.click(await openFullAiDeck(container));
    const answer = await screen.findByRole('button', {
      name: 'One card per page',
    });

    failAccountRead();
    fireEvent.click(answer);

    expect(await screen.findByText(UNCONFIRMED)).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(2);
  });

  it('holds Try again of a resumed Claude resend, and says why, when the account cannot be read', async () => {
    await saveInterruptedUpload({ aiFlag: 'true', claudeResend: true });
    const fetchMock = stubServer([networkDrop, asyncJobAccepted]);
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} aiOn={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    const retry = await screen.findByRole('button', { name: 'Try again' });

    failAccountRead();
    fireEvent.click(retry);

    expect(await screen.findByText(UNCONFIRMED)).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
  });

  it('keeps Claude on when the account that sent it taps Try again after a resumed Claude resend', async () => {
    stubLeavingPage();
    await saveInterruptedUpload({ aiFlag: 'true', claudeResend: true });
    const fetchMock = stubServer([networkDrop, asyncJobAccepted]);
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} aiOn={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    const retried = await nthUpload(fetchMock, 2);
    expect(retried.getAll('claude-ai-flashcards')).toEqual(['true']);
    expect(retried.getAll('pdf-page-pairs')).toEqual(['false']);
  });

  it('makes the full AI deck with Claude and page pairs off for a signed-out Day Pass holder', async () => {
    globalThis.localStorage.setItem('pdf-page-pairs', 'true');
    setUserLocals(passHolderWithoutAccount);
    withThinDeckPreview();
    const fetchMock = stubServer([deckResponse(2), deckResponse(9)]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    fireEvent.click(await openFullAiDeck(container));

    const resent = await nthUpload(fetchMock, 2);
    expect(resent.getAll('claude-ai-flashcards')).toEqual(['true']);
    expect(resent.getAll('pdf-page-pairs')).toEqual(['false']);
    expect(resent.getAll('kept-owner')).toEqual(['none']);
  });

  it('resumes the file a signed-out visitor left for the Day Pass with Claude on, two pages make one card off and no account, through the save made before checkout', async () => {
    globalThis.localStorage.setItem('pdf-page-pairs', 'true');
    setUserLocals(visitorWithThinDeckOffer);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi
        .fn()
        .mockResolvedValue({ url: 'https://checkout.example/pass' }),
      getUploads: vi.fn().mockResolvedValue([]),
      getHeldDeck: vi.fn().mockResolvedValue(null),
      previewThinDeckAi: vi.fn().mockResolvedValue({
        kind: 'preview',
        cards: [{ front: 'What does the Krebs cycle make?', back: 'ATP' }],
      }),
      resumeAiPreview: vi.fn(),
    } as unknown as ReturnType<typeof get2ankiApi>);
    const leaving = stubLeavingPage();
    const fetchMock = stubServer([deckResponse(2), deckResponse(9)]);
    const first = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(first.container, ['notes.pdf']);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Preview cards Claude would write',
      })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /Get every card: Day Pass/ })
    );
    await waitFor(() =>
      expect(leaving.href).toBe('https://checkout.example/pass')
    );
    first.unmount();

    vi.stubGlobal('location', {
      search: '?pass_session=cs_thin',
      href: 'http://localhost/upload?pass_session=cs_thin',
      origin: 'http://localhost',
    });
    setUserLocals(passHolderWithoutAccount);
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} aiOn={false} />);

    const resumed = await nthUpload(fetchMock, 2);
    expect(resumed.getAll('claude-ai-flashcards')).toEqual(['true']);
    expect(resumed.getAll('pdf-page-pairs')).toEqual(['false']);
    expect(resumed.getAll('kept-owner')).toEqual(['none']);
  });

  it('holds a password unlock for a file whose sender the page never learned, and says why', async () => {
    accountReadFailed(passHolder);
    const fetchMock = stubLockedPdfServer(5);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['locked.pdf']);

    await unlockWithPassword();

    expect(
      await screen.findByText(SENDER_UNKNOWN, { selector: 'p' })
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/upload/retry-with-credential')).toEqual([]);
  });

  it('clears a save whose sender was never known, with no Continue banner, for a signed-in account', async () => {
    await saveInterruptedUpload({ ownerId: null, ownerUnknown: true });
    stubServer([deckResponse(64)]);
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} aiOn={false} />);

    await waitFor(async () =>
      expect(await getPendingUploadStore().load()).toBeNull()
    );
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('holds a file left mid-upload while the page had no account data, when a signed-out page picks it up from the Continue banner', async () => {
    accountReadFailed(passHolder);
    const fetchMock = stubServer([new Promise<never>(() => {})]);
    const first = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(first.container, ['lecture.pdf']);
    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1)
    );
    first.unmount();

    setUserLocals(signedOut);
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} aiOn={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByText(SENDER_UNKNOWN, { selector: 'p' })
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
  });

  it('claims no change of session while the page has no account data, and still sends the kept file as the sender the server named', async () => {
    readLocalsAgain = vi.fn().mockResolvedValue({
      data: undefined,
      status: 'error',
      isError: true,
    });
    mockUseUserLocals.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('locals'),
      isError: true,
      refetch: readLocalsAgain,
    } as unknown as ReturnType<typeof useUserLocals>);
    const fetchMock = stubServer([
      jsonAnswer(
        400,
        { ...emptyExport, rescue: [{ rule: 'heading', cards: 2 }] },
        sentBy('7')
      ),
      deckResponse(2),
    ]);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['notes.html']);
    const pick = await screen.findByRole('button', {
      name: 'Make 2 cards from the headings',
    });
    expect(screen.queryByText(SIGNED_OUT_LINE, { selector: 'p' })).toBeNull();

    fireEvent.click(pick);

    expect((await nthUpload(fetchMock, 2)).getAll('kept-owner')).toEqual(['7']);
  });

  const liveRegion = (container: HTMLElement) =>
    container.querySelector('output')?.textContent;

  it.each([
    [
      'the deck-ready screen, in place of Rebuild with Claude',
      OTHER_ACCOUNT_LINE,
      'Your deck is ready — 64 cards.',
      async () => {
        stubServer([deckResponse(64)]);
        const view = renderRebuildForm(false);
        await submitFiles(view.container, ['lecture.pdf']);
        await screen.findByText(OFFER);
        setUserLocals(otherPassHolder);
        view.rerenderWithAi(false);
        return view.container;
      },
    ],
    [
      'the deck-ready screen, in place of the thin-deck offer',
      OTHER_ACCOUNT_LINE,
      'Your deck is ready — 2 cards.',
      async () => {
        setUserLocals(passHolderWithThinDeckOffer);
        withThinDeckPreview();
        stubServer([deckResponse(2)]);
        const view = renderRebuildForm(false);
        await submitFiles(view.container, ['notes.pdf']);
        await screen.findByRole('button', {
          name: 'Preview cards Claude would write',
        });
        setUserLocals(otherPassHolderWithThinDeckOffer);
        view.rerenderWithAi(false);
        return view.container;
      },
    ],
    [
      'the empty-deck screen',
      OTHER_ACCOUNT_LINE,
      'Conversion finished, but no cards were found.',
      async () => {
        stubServer([
          jsonAnswer(400, {
            ...emptyExport,
            rescue: [{ rule: 'heading', cards: 2 }],
          }),
        ]);
        const view = renderRebuildForm(false);
        await submitFiles(view.container, ['notes.html']);
        await screen.findByRole('button', {
          name: 'Make 2 cards from the headings',
        });
        setUserLocals(otherPassHolder);
        view.rerenderWithAi(false);
        return view.container;
      },
    ],
    [
      'the network-error screen',
      OTHER_ACCOUNT_LINE,
      'Conversion failed.',
      async () => {
        stubServer([networkDrop]);
        const view = renderRebuildForm(false);
        await submitFiles(view.container, ['lecture.pdf']);
        await screen.findByRole('button', { name: 'Try again' });
        setUserLocals(otherPassHolder);
        view.rerenderWithAi(false);
        return view.container;
      },
    ],
    [
      'the AI preview',
      SIGNED_IN_LINE,
      '',
      async () => {
        setUserLocals(signedOutWithAiPreview);
        stubServer([visitorPreview]);
        const view = renderRebuildForm(true);
        await submitFiles(view.container, ['lecture.pdf']);
        await screen.findByRole('button', { name: 'Continue without AI' });
        setUserLocals(otherPassHolder);
        view.rerenderWithAi(true);
        return view.container;
      },
    ],
    [
      'the PDF question',
      OTHER_ACCOUNT_LINE,
      "We can't tell questions from answers in this PDF.",
      async () => {
        stubServer([pdfQuestion]);
        const view = renderRebuildForm(false);
        await submitFiles(view.container, ['scan.pdf']);
        await screen.findByRole('button', { name: 'One card per page' });
        setUserLocals(otherPassHolder);
        view.rerenderWithAi(false);
        return view.container;
      },
    ],
  ] as Array<[string, string, string, () => Promise<HTMLElement>]>)(
    'announces the line on %s once the page shows another session, after what the screen says',
    async (_screen, line, status, showSwitch) => {
      const container = await showSwitch();

      expect(screen.getByText(line, { selector: 'p' })).toBeVisible();
      expect(liveRegion(container)).toBe(
        status === '' ? line : `${status} ${line}`
      );
    }
  );

  it('joins the status and the line with a Japanese full stop and no space in Japanese', async () => {
    stubServer([networkDrop]);
    const view = renderRebuildForm(false);
    await submitFiles(view.container, ['lecture.pdf']);
    await screen.findByRole('button', { name: 'Try again' });
    setUserLocals(otherPassHolder);
    view.rerenderWithAi(false);

    try {
      await act(async () => {
        await i18n.changeLanguage('ja');
      });

      expect(liveRegion(view.container)).toBe(
        '変換に失敗しました。今は別のアカウントでログインしています。そのアカウントで変換するには、ファイルをもう一度選んでください。'
      );
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    }
  });

  it('keeps the shown switch line out of any live region but the page one', async () => {
    stubServer([deckResponse(64)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    await submitFiles(container, ['lecture.pdf']);
    await screen.findByText(OFFER);
    setUserLocals(otherPassHolder);
    rerenderWithAi(false);

    const shown = screen.getByText(OTHER_ACCOUNT_LINE, { selector: 'p' });
    expect(shown).not.toHaveAttribute('role');
    expect(shown).not.toHaveAttribute('aria-live');
    expect(
      shown.closest('[role="status"], [role="alert"], [aria-live]')
    ).toBeNull();
  });

  it.each([
    [
      'a deck',
      deckResponse(64, sentBy('9')),
      ['lecture.pdf'],
      'Your deck is ready — 64 cards.',
    ],
    [
      'no cards',
      jsonAnswer(
        400,
        { ...emptyExport, rescue: [{ rule: 'heading', cards: 2 }] },
        sentBy('9')
      ),
      ['notes.html'],
      'Conversion finished, but no cards were found.',
    ],
  ] as Array<[string, UploadAnswer, string[], string]>)(
    'announces %s that arrives under another session, then the line once',
    async (_what, answer, files, status) => {
      stubServer([answer]);
      const { container } = renderRebuildForm(false);
      await submitFiles(container, files);

      await screen.findByText(OTHER_ACCOUNT_LINE, { selector: 'p' });
      expect(liveRegion(container)).toBe(`${status} ${OTHER_ACCOUNT_LINE}`);
    }
  );

  it("clears an unknown sender's save left for the Day Pass on a signed-in page, without holding or resuming it", async () => {
    vi.stubGlobal('location', {
      search: '?from=pass&session_id=cs_thin',
      href: 'http://localhost/upload?from=pass&session_id=cs_thin',
      origin: 'http://localhost',
    });
    markThinDeckResume();
    setUserLocals(freeSignedIn);
    const fetchMock = stubServer([deckResponse(9)]);
    const { rerenderWithAi } = renderRebuildForm(false);
    await settle();
    await saveInterruptedUpload({
      ownerId: null,
      ownerUnknown: true,
      aiFlag: 'true',
      claudeResend: true,
    });

    setUserLocals({
      ...freeSignedIn,
      locals: { owner: 8, patreon: false, subscriber: true, passKind: '24h' },
    } as unknown as ReturnType<typeof useUserLocals>['data']);
    rerenderWithAi(false);

    await waitFor(async () =>
      expect(await getPendingUploadStore().load()).toBeNull()
    );
    await settle();
    expect(eventsNamed('thin_deck_ai_unlock_clicked')).toEqual([]);
    expect(screen.queryByText(SENDER_UNKNOWN, { selector: 'p' })).toBeNull();
    expect(callsTo(fetchMock, '/api/upload/file')).toEqual([]);
  });

  it("holds an unknown sender's save left for the Day Pass on a signed-out page, and records no resumed send", async () => {
    vi.stubGlobal('location', {
      search: '?from=pass&session_id=cs_thin',
      href: 'http://localhost/upload?from=pass&session_id=cs_thin',
      origin: 'http://localhost',
    });
    markThinDeckResume();
    await saveInterruptedUpload({
      ownerId: null,
      ownerUnknown: true,
      aiFlag: 'true',
      claudeResend: true,
    });
    setUserLocals(signedOut);
    const fetchMock = stubServer([deckResponse(9)]);
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} aiOn={false} />);

    expect(
      await screen.findByText(SENDER_UNKNOWN, { selector: 'p' })
    ).toBeInTheDocument();
    expect(eventsNamed('thin_deck_ai_unlock_clicked')).toEqual([]);
    expect(callsTo(fetchMock, '/api/upload/file')).toEqual([]);
  });

  it("keeps the Day Pass buyer's own save when the account read failed on the way back", async () => {
    vi.stubGlobal('location', {
      search: '?from=pass&session_id=cs_thin',
      href: 'http://localhost/upload?from=pass&session_id=cs_thin',
      origin: 'http://localhost',
    });
    markThinDeckResume();
    await saveInterruptedUpload({ aiFlag: 'true', claudeResend: true });
    accountReadFailed(passHolder);
    const fetchMock = stubServer([deckResponse(9)]);
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} aiOn={false} />);
    await settle();

    expect(await getPendingUploadStore().load()).toMatchObject({
      ownerId: 7,
      aiFlag: 'true',
    });
    expect(callsTo(fetchMock, '/api/upload/file')).toEqual([]);
  });

  it("clears an unknown sender's save, sends nothing, and says the page is signed in now when Continue is clicked after a sign-in", async () => {
    await saveInterruptedUpload({ ownerId: null, ownerUnknown: true });
    setUserLocals(signedOut);
    const fetchMock = stubServer([deckResponse(9)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    const resume = await screen.findByRole('button', { name: 'Continue' });

    setUserLocals(freeSignedIn);
    rerenderWithAi(false);
    fireEvent.click(resume);

    expect(
      await screen.findByText(SIGNED_IN_LINE, { selector: 'p' })
    ).toBeInTheDocument();
    expect(liveRegion(container)).toBe(SIGNED_IN_LINE);
    expect(await getPendingUploadStore().load()).toBeNull();
    expect(screen.queryByText(SENDER_UNKNOWN, { selector: 'p' })).toBeNull();
    expect(callsTo(fetchMock, '/api/upload/file')).toEqual([]);
  });

  it('drops the closing line once a new file goes out', async () => {
    await saveInterruptedUpload({ ownerId: null, ownerUnknown: true });
    setUserLocals(signedOut);
    stubServer([new Promise<never>(() => {})]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    const resume = await screen.findByRole('button', { name: 'Continue' });
    setUserLocals(freeSignedIn);
    rerenderWithAi(false);
    fireEvent.click(resume);
    await screen.findByText(SIGNED_IN_LINE, { selector: 'p' });

    await submitFiles(container, ['lecture.pdf']);

    expect(screen.queryByText(SIGNED_IN_LINE, { selector: 'p' })).toBeNull();
  });

  it('says the page is signed out now when Continue is clicked after the session ended, beside the last deck still on offer', async () => {
    await saveInterruptedUpload({ ownerId: 7 });
    await getLastDeckStore().save({
      recoveryToken: '0b6f2c1e-3a4d-4e5f-8a9b-1c2d3e4f5a6b',
      deckName: 'Biology.apkg',
      savedAt: Date.now(),
    });
    const fetchMock = stubServer([deckResponse(9)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    const resume = await screen.findByRole('button', { name: 'Continue' });

    setUserLocals(signedOut);
    rerenderWithAi(false);
    fireEvent.click(resume);

    const closing = await screen.findByText(SIGNED_OUT_LINE, { selector: 'p' });
    const lastDeck = await screen.findByText(/Your last deck,/);
    expect(liveRegion(container)).toBe(SIGNED_OUT_LINE);
    expect(
      lastDeck.compareDocumentPosition(closing) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getAllByText(SIGNED_OUT_LINE, { selector: 'p' })
    ).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?redirect=/upload'
    );
    expect(await getPendingUploadStore().load()).toMatchObject({ ownerId: 7 });
    expect(callsTo(fetchMock, '/api/upload/file')).toEqual([]);
  });

  it('hides the closing line while the upload lock shows', async () => {
    await saveInterruptedUpload({ ownerId: 7 });
    stubServer([deckResponse(9)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    const resume = await screen.findByRole('button', { name: 'Continue' });
    setUserLocals(otherPassHolder);
    rerenderWithAi(false);
    fireEvent.click(resume);
    await screen.findByText(OTHER_ACCOUNT_LINE, { selector: 'p' });

    mockUseCardUsage.mockReturnValue({
      cards_used: 100,
      cards_limit: 100,
      unlimited: false,
      loading: false,
    } as unknown as ReturnType<typeof useCardUsage>);
    setUserLocals(freeSignedIn);
    rerenderWithAi(false);

    expect(
      screen.queryByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeNull();
    expect(liveRegion(container)).toBe('');
  });

  it("says another account is signed in now when Continue is clicked on a save another account's page left", async () => {
    await saveInterruptedUpload({ ownerId: 7 });
    const fetchMock = stubServer([deckResponse(9)]);
    const { container, rerenderWithAi } = renderRebuildForm(false);
    const resume = await screen.findByRole('button', { name: 'Continue' });

    setUserLocals(otherPassHolder);
    rerenderWithAi(false);
    fireEvent.click(resume);

    expect(
      await screen.findByText(OTHER_ACCOUNT_LINE, { selector: 'p' })
    ).toBeInTheDocument();
    expect(liveRegion(container)).toBe(OTHER_ACCOUNT_LINE);
    expect(callsTo(fetchMock, '/api/upload/file')).toEqual([]);
  });

  // Headers trims what it is given, so the value goes out as written.
  function namedAsWritten(answer: ReturnType<typeof jsonAnswer>, raw: string) {
    const read = answer.headers.get.bind(answer.headers);
    answer.headers.get = (name: string) =>
      name.toLowerCase() === 'x-upload-owner' ? raw : read(name);
    return answer;
  }

  it.each(['', ' 42 ', '0x2A', '1e3', '-7', '7.0', '9007199254740993'])(
    'holds a resend when the server names the session as "%s", as for no answer at all',
    async (raw) => {
      accountReadFailed(passHolder);
      const fetchMock = stubServer([
        namedAsWritten(
          jsonAnswer(400, {
            ...emptyExport,
            rescue: [{ rule: 'heading', cards: 2 }],
          }),
          raw
        ),
        deckResponse(2),
      ]);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );
      await submitFiles(container, ['notes.html']);

      fireEvent.click(
        await screen.findByRole('button', {
          name: 'Make 2 cards from the headings',
        })
      );

      expect(
        await screen.findByText(SENDER_UNKNOWN, { selector: 'p' })
      ).toBeInTheDocument();
      expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
    }
  );

  type ShownLocals = ReturnType<typeof useUserLocals>['data'];

  it('never shows the closing line on a sample page, which offers no Continue', async () => {
    await saveInterruptedUpload({ ownerId: 7 });
    stubServer([deckResponse(9)]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = () => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <UploadForm setErrorMessage={vi.fn()} aiOn={false} sample />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const view = render(tree());
    await settle();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();

    for (const next of [otherPassHolder, signedOut, freeSignedIn]) {
      setUserLocals(next);
      view.rerender(tree());
      await settle();
      for (const line of [
        OTHER_ACCOUNT_LINE,
        SIGNED_OUT_LINE,
        SIGNED_IN_LINE,
      ]) {
        expect(screen.queryByText(line, { selector: 'p' })).toBeNull();
      }
    }
  });

  it.each([
    ['off', false],
    ['on', true],
  ])(
    'reads the account again when an upload is sent on to the limit page, and shows the limit for the session the server saw (limitWallPassFirst %s)',
    async (_arm, passFirst) => {
      const withFlag = (locals: ShownLocals) =>
        ({
          ...locals,
          features: { limitWallPassFirst: passFirst },
        }) as ShownLocals;
      setUserLocals(withFlag(signedOut));
      const readAgain = readLocalsAgain;
      mockReadUserLocalsOnce.mockResolvedValue(
        withFlag(freeSignedIn) as Awaited<ReturnType<typeof readUserLocalsOnce>>
      );
      stubServer([
        {
          redirected: true,
          url: 'http://localhost/limit?kind=card_count',
          status: 200,
          headers: new Headers({}),
        } as unknown as UploadAnswer,
      ]);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );

      await submitFiles(container, ['lecture.pdf']);

      expect(
        await screen.findByRole('link', { name: 'See plans' })
      ).toBeInTheDocument();
      expect(mockReadUserLocalsOnce).toHaveBeenCalledTimes(1);
      expect(readAgain).not.toHaveBeenCalled();
      expect(
        screen.queryByRole('link', { name: 'Create a free account' })
      ).toBeNull();
      expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    }
  );

  it.each([['fails'], ['never answers']])(
    'keeps the limit screen the page would show when the account read %s',
    async (read) => {
      setUserLocals(signedOut);
      mockReadUserLocalsOnce.mockImplementation(() =>
        read === 'fails'
          ? Promise.reject(new Error('locals'))
          : new Promise<never>(() => {})
      );
      stubServer([
        {
          redirected: true,
          url: 'http://localhost/limit?kind=card_count',
          status: 200,
          headers: new Headers({}),
        } as unknown as UploadAnswer,
      ]);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      );

      await submitFiles(container, ['lecture.pdf']);
      await settle();

      expect(
        screen.getByRole('link', { name: 'Create a free account' })
      ).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull();
    }
  );

  // A signed-out page whose session signed in elsewhere; the server sends
  // the upload on to the limit page.
  function limitRedirectForSessionSignedInElsewhere() {
    setUserLocals(signedOut);
    const readAgain = readLocalsAgain;
    mockReadUserLocalsOnce.mockResolvedValue(
      freeSignedIn as Awaited<ReturnType<typeof readUserLocalsOnce>>
    );
    const fetchMock = stubServer([
      {
        redirected: true,
        url: 'http://localhost/limit?kind=card_count',
        status: 200,
        headers: new Headers({}),
      } as unknown as UploadAnswer,
    ]);
    return { readAgain, fetchMock };
  }

  async function expectSignedInLimitActions(readAgain: Mock) {
    expect(
      await screen.findByRole('link', { name: 'See plans' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Get Day Pass/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Create a free account' })
    ).toBeNull();
    expect(mockReadUserLocalsOnce).toHaveBeenCalledTimes(1);
    expect(readAgain).not.toHaveBeenCalled();
  }

  it('reads the account once and shows the limit for the session the server saw when a file handed over from Print or CSV is sent on to the limit page', async () => {
    const { readAgain, fetchMock } = limitRedirectForSessionSignedInElsewhere();
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/upload',
            state: {
              handoffFile: new File(['# notes'], 'notes.zip', {
                type: 'application/zip',
              }),
            },
          },
        ]}
      >
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
        </QueryClientProvider>
      </MemoryRouter>
    );

    await expectSignedInLimitActions(readAgain);
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
  });

  it('reads the account once and shows the limit for the session the server saw when a dropped folder is sent on to the limit page', async () => {
    class FakeDataTransfer {
      files: File[] = [];
      items = { add: (file: File) => this.files.push(file) };
    }
    vi.stubGlobal('DataTransfer', FakeDataTransfer);
    const { readAgain, fetchMock } = limitRedirectForSessionSignedInElsewhere();
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [],
      writable: true,
      configurable: true,
    });
    input.removeAttribute('required');
    const page = {
      isFile: true,
      isDirectory: false,
      name: 'notes.html',
      fullPath: '/notes/notes.html',
      file: (resolve: (file: File) => void) =>
        resolve(new File(['<html><body>Krebs</body></html>'], 'notes.html')),
    };
    const folder = {
      isFile: false,
      isDirectory: true,
      name: 'notes',
      fullPath: '/notes',
      createReader: () => {
        const batches: unknown[][] = [[page], []];
        return {
          readEntries: (resolve: (batch: unknown[]) => void) => {
            resolve(batches.shift() ?? []);
          },
        };
      },
    };

    dropOnPage({ items: [{ webkitGetAsEntry: () => folder }], files: [] });

    await expectSignedInLimitActions(readAgain);
    expect(callsTo(fetchMock, '/api/upload/file')).toHaveLength(1);
  });

  it('sends a password unlock once when Enter and a click land together', async () => {
    const fetchMock = stubLockedPdfServer(5);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
    );
    await submitFiles(container, ['locked.pdf']);
    const password = await screen.findByLabelText('PDF password');
    fireEvent.change(password, { target: { value: 'open-sesame' } });

    await act(async () => {
      fireEvent.keyDown(password, { key: 'Enter' });
      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    });

    await settle();
    expect(
      callsTo(fetchMock, '/api/upload/retry-with-credential')
    ).toHaveLength(1);
  });
});

describe('UploadForm try-a-sample', () => {
  const anonymousData = {
    user: null,
    locals: { owner: 0, patreon: false, subscriber: false },
  } as unknown as ReturnType<typeof useUserLocals>['data'];

  function setUserLocals(data: ReturnType<typeof useUserLocals>['data']) {
    mockUseUserLocals.mockReturnValue({
      data,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    });
  }

  function stubSampleSuccess() {
    const fetchMock = vi.fn().mockResolvedValue({
      redirected: false,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/apkg',
        'Content-Disposition': 'attachment; filename="Sample deck.apkg"',
        'X-Card-Count': '8',
      }),
      blob: () => Promise.resolve(new Blob(['fake'])),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    vi.mocked(track).mockClear();
    mockUseCardUsage.mockReturnValue(null);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
      getUploads: vi.fn().mockResolvedValue([]),
      getHeldDeck: vi.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof get2ankiApi>);
  });

  afterEach(() => {
    setUserLocals(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the sample control only when the sample prop is set', () => {
    const withoutSample = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    expect(
      withoutSample.queryByRole('button', { name: 'Try a sample' })
    ).toBeNull();
    withoutSample.unmount();

    const withSample = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} sample />
    );
    expect(
      withSample.getByRole('button', { name: 'Try a sample' })
    ).toBeInTheDocument();
  });

  it('posts to /api/upload/sample and fires sample_conversion_started', async () => {
    const fetchMock = stubSampleSuccess();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} sample />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try a sample' }));
    });

    expect(
      fetchMock.mock.calls.find((call) => call[0] === '/api/upload/sample')
    ).toBeDefined();
    const sampleCall = fetchMock.mock.calls.find(
      (call) => call[0] === '/api/upload/sample'
    )!;
    expect(sampleCall[1]).toEqual(expect.objectContaining({ method: 'post' }));
    expect(vi.mocked(track)).toHaveBeenCalledWith('sample_conversion_started');
  });

  it('shows the sample note and a convert-your-own reset on success', async () => {
    stubSampleSuccess();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} sample />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try a sample' }));
    });

    await screen.findByText(
      'This is a sample deck. Convert your own file next.'
    );
    expect(
      screen.getByRole('button', { name: 'Convert your own file' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Make another deck' })
    ).toBeNull();
  });

  it('records sample_deck_downloaded, not the funnel deck_downloaded, on a sample', async () => {
    const gtag = vi.fn();
    (globalThis as { gtag?: unknown }).gtag = gtag;
    stubSampleSuccess();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} sample />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try a sample' }));
    });

    await screen.findByText(
      'This is a sample deck. Convert your own file next.'
    );
    expect(vi.mocked(track)).toHaveBeenCalledWith('sample_deck_downloaded');
    expect(vi.mocked(track)).not.toHaveBeenCalledWith(
      'deck_downloaded',
      expect.anything()
    );
    expect(vi.mocked(track)).not.toHaveBeenCalledWith('deck_downloaded');
    expect(gtag).not.toHaveBeenCalledWith('event', 'deck_downloaded');
    delete (globalThis as { gtag?: unknown }).gtag;
  });

  it('suppresses the create-account notice for an anonymous sample run', async () => {
    setUserLocals(anonymousData);
    stubSampleSuccess();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} sample />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try a sample' }));
    });

    await screen.findByText(
      'This is a sample deck. Convert your own file next.'
    );
    expect(vi.mocked(track)).not.toHaveBeenCalledWith(
      'account_offer_shown',
      expect.anything()
    );
  });

  it('does not leak the sample state into a following real upload', async () => {
    setUserLocals(anonymousData);
    stubSampleSuccess();

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} sample />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try a sample' }));
    });
    await screen.findByText(
      'This is a sample deck. Convert your own file next.'
    );

    vi.mocked(track).mockClear();

    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['x'], 'my-notes.zip')],
      configurable: true,
    });
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    await waitFor(() =>
      expect(vi.mocked(track)).toHaveBeenCalledWith(
        'account_offer_shown',
        expect.anything()
      )
    );
    expect(
      screen.queryByText('This is a sample deck. Convert your own file next.')
    ).toBeNull();
    expect(vi.mocked(track)).not.toHaveBeenCalledWith('sample_deck_downloaded');
    expect(vi.mocked(track)).not.toHaveBeenCalledWith(
      'sample_conversion_started'
    );
  });

  it('does not fire upload_cancelled when the page hides during a sample conversion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {}))
    );

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} sample />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try a sample' }));
    });

    await act(async () => {
      globalThis.dispatchEvent(new Event('pagehide'));
    });

    expect(vi.mocked(track)).not.toHaveBeenCalledWith(
      'upload_cancelled',
      expect.anything()
    );
  });
});

describe('UploadForm monthly-limit partial offer', () => {
  function setUserLocals(data: ReturnType<typeof useUserLocals>['data']) {
    mockUseUserLocals.mockReturnValue({
      data,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    });
  }

  beforeEach(() => {
    vi.mocked(track).mockClear();
    mockUseCardUsage.mockReturnValue(null);
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
      getUploads: vi.fn().mockResolvedValue([]),
      getHeldDeck: vi.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof get2ankiApi>);
  });

  afterEach(() => {
    setUserLocals(undefined);
    vi.unstubAllGlobals();
  });

  async function uploadWithHeaders(headers: Record<string, string>) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="deck.apkg"',
          ...headers,
        }),
        blob: () => Promise.resolve(new Blob(['fake'])),
      })
    );
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['x'], 'notes.html')],
      configurable: true,
    });
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
    });
    await screen.findByRole('button', { name: 'Make another deck' });
  }

  it('tells a signed-in free user the deck was cut and offers the rest', async () => {
    setUserLocals({
      user: { id: 2, email: 'free@example.com' },
      locals: { owner: 2, patreon: false, subscriber: false },
    } as unknown as ReturnType<typeof useUserLocals>['data']);

    await uploadWithHeaders({
      'X-Card-Count': '42',
      'X-Cards-Held-Back': '300',
      'X-Held-For-Plan': '1',
    });

    expect(
      screen.getByText('This deck has 42 of 342 cards')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The other 300 are saved for 7 days/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Day Pass/ })
    ).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('monthly_partial_offer_shown', {
      cards_held_back: 300,
      saved: true,
    });
    expect(screen.queryByText('How was your experience?')).toBeNull();
  });

  it('shows no offer when nothing was held back', async () => {
    setUserLocals({
      user: { id: 2, email: 'free@example.com' },
      locals: { owner: 2, patreon: false, subscriber: false },
    } as unknown as ReturnType<typeof useUserLocals>['data']);

    await uploadWithHeaders({ 'X-Card-Count': '42' });

    expect(screen.queryByText(/This deck has 42 of/)).toBeNull();
    expect(screen.getByText('How was your experience?')).toBeInTheDocument();
    expect(track).not.toHaveBeenCalledWith(
      'monthly_partial_offer_shown',
      expect.anything()
    );
  });
});

describe('claiming a held deck after sign-in', () => {
  const signIn = () =>
    mockUseUserLocals.mockReturnValue({
      data: { user: { id: 42 }, locals: { owner: 42 } },
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);

  const mockClaim = (result: {
    status: number;
    error: { code: string; message: string; empty_reason?: string } | null;
  }) =>
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn(),
      getUploads: vi.fn().mockResolvedValue([]),
      getHeldDeck: vi
        .fn()
        .mockResolvedValue({ cardCount: 21, cardsHeldBack: 13 }),
      claimHeldDeck: vi.fn().mockResolvedValue({
        downloadKey: null,
        cardCount: null,
        deckName: null,
        ...result,
      }),
    } as unknown as ReturnType<typeof get2ankiApi>);

  beforeEach(() => {
    mockReportClientError.mockClear();
  });

  it('shows the empty-deck help when the owner conversion has no cards', async () => {
    signIn();
    mockClaim({
      status: 400,
      error: {
        code: 'empty_export',
        message: 'No cards found in your upload.',
        empty_reason: 'all_filtered',
      },
    });
    const setErrorMessage = vi.fn();

    renderUploadForm(<UploadForm setErrorMessage={setErrorMessage} />);

    expect(
      await screen.findByText(/A card filter removed every card/)
    ).toBeInTheDocument();
    expect(setErrorMessage).not.toHaveBeenCalled();
    expect(mockReportClientError).not.toHaveBeenCalled();
  });

  it('offers the passes for the rest of a sign-up claim cut to the preview', async () => {
    signIn();
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn(),
      getUploads: vi.fn().mockResolvedValue([]),
      getHeldDeck: vi
        .fn()
        .mockResolvedValue({ cardCount: 21, cardsHeldBack: 163 }),
      claimHeldDeck: vi.fn().mockResolvedValue({
        status: 200,
        downloadKey: 'owner-key.apkg',
        cardCount: 21,
        deckName: 'notes',
        kind: 'signup',
        error: null,
        cardsHeldBack: 163,
        heldForPlan: true,
      }),
    } as unknown as ReturnType<typeof get2ankiApi>);

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);

    expect(
      await screen.findByText('184 cards ready, 21 shown')
    ).toBeInTheDocument();
    expect(screen.getByText(/saved for 7 days/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Semester Pass/ })
    ).toBeInTheDocument();
  });

  it('tells the account to re-upload when the rest of a preview could not be saved', async () => {
    signIn();
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn(),
      getUploads: vi.fn().mockResolvedValue([]),
      getHeldDeck: vi
        .fn()
        .mockResolvedValue({ cardCount: 21, cardsHeldBack: 163 }),
      claimHeldDeck: vi.fn().mockResolvedValue({
        status: 200,
        downloadKey: 'owner-key.apkg',
        cardCount: 21,
        deckName: 'notes',
        kind: 'signup',
        error: null,
        cardsHeldBack: 163,
        heldForPlan: false,
      }),
    } as unknown as ReturnType<typeof get2ankiApi>);

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);

    expect(
      await screen.findByText(
        'A free account gets the first 21. Get a pass, then drop the file again for all 184.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/saved for 7 days/)).not.toBeInTheDocument();
  });

  it('shows no pass offer after a full sign-up claim', async () => {
    signIn();
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn(),
      getUploads: vi.fn().mockResolvedValue([]),
      getHeldDeck: vi
        .fn()
        .mockResolvedValue({ cardCount: 21, cardsHeldBack: 13 }),
      claimHeldDeck: vi.fn().mockResolvedValue({
        status: 200,
        downloadKey: 'owner-key.apkg',
        cardCount: 34,
        deckName: 'notes',
        kind: 'signup',
        error: null,
      }),
    } as unknown as ReturnType<typeof get2ankiApi>);

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);

    expect(
      await screen.findByText("You're signed in. Download your deck below.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Semester Pass/ })
    ).not.toBeInTheDocument();
  });

  it('reports a failed claim with its status and keeps the generic message', async () => {
    signIn();
    mockClaim({
      status: 500,
      error: { code: 'unknown', message: 'Something broke on our end.' },
    });
    const setErrorMessage = vi.fn();

    renderUploadForm(<UploadForm setErrorMessage={setErrorMessage} />);

    await waitFor(() => expect(setErrorMessage).toHaveBeenCalledTimes(1));
    const notice = setErrorMessage.mock.calls[0][0] as UserNotice;
    expect(notice).toBeInstanceOf(UserNotice);
    expect(notice.message).toBe('Conversion failed.');
    expect(mockReportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 500,
        message:
          'Held deck claim failed (HTTP 500): Something broke on our end.',
      }),
      { surface: 'held_deck_claim' }
    );
  });

  describe('after a checkout return', () => {
    afterEach(() => {
      vi.useRealTimers();
      globalThis.history.replaceState({}, '', '/');
    });

    function mockHoldAppearingLater() {
      const getHeldDeck = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ cardCount: 42, cardsHeldBack: 300 });
      const claimHeldDeck = vi.fn().mockResolvedValue({
        status: 200,
        downloadKey: 'full-deck.apkg',
        cardCount: 342,
        deckName: 'notes',
        kind: 'plan',
        error: null,
      });
      mockGet2ankiApi.mockReturnValue({
        startPassCheckout: vi.fn(),
        getUploads: vi.fn().mockResolvedValue([]),
        getHeldDeck,
        claimHeldDeck,
      } as unknown as ReturnType<typeof get2ankiApi>);
      return { getHeldDeck, claimHeldDeck };
    }

    it('keeps checking until the paid-for deck is visible, then claims it', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      globalThis.history.replaceState(
        {},
        '',
        '/upload?from=pass&session_id=cs_test_1'
      );
      signIn();
      const { getHeldDeck, claimHeldDeck } = mockHoldAppearingLater();

      renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7000);
      });

      expect(getHeldDeck).toHaveBeenCalledTimes(3);
      await waitFor(() => expect(claimHeldDeck).toHaveBeenCalledTimes(1));
      expect(
        await screen.findByText(
          "Your full deck is ready. It's in My decks too."
        )
      ).toBeInTheDocument();
    });

    it('checks once when the visitor did not just come back from checkout', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      signIn();
      const { getHeldDeck, claimHeldDeck } = mockHoldAppearingLater();

      renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7000);
      });

      expect(getHeldDeck).toHaveBeenCalledTimes(1);
      expect(claimHeldDeck).not.toHaveBeenCalled();
    });
  });
});

describe('UploadForm PDF with no readable text', () => {
  beforeEach(() => {
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    (globalThis as AnalyticsGlobals).hj = vi.fn();
    globalThis.localStorage.clear();
    mockUseUserLocals.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
    mockUseCardUsage.mockReturnValue(null);
  });

  afterEach(() => {
    delete (globalThis as AnalyticsGlobals).gtag;
    delete (globalThis as AnalyticsGlobals).hj;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    globalThis.localStorage.clear();
  });

  function selectFiles(container: HTMLElement, files: File[]) {
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: files,
      configurable: true,
    });
    fileInput.removeAttribute('required');
  }

  function selectFile(container: HTMLElement, name: string) {
    selectFiles(container, [
      new File(['x'], name, { type: 'application/pdf' }),
    ]);
  }

  async function submitForm(container: HTMLElement) {
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });
  }

  function sentFallback(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
    const calls = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/upload/file'
    );
    const body = calls[call]?.[1]?.body as FormData | undefined;
    return body?.get('pdf-fallback') ?? null;
  }

  // The server names the session each upload ran under: a signed-out
  // visitor unless a test signs someone in.
  const choiceResponse = (reason = 'no_text', session = 'none') => ({
    redirected: false,
    status: 409,
    clone: () => ({
      json: () =>
        Promise.resolve({
          code: 'choose_pdf_mode',
          reason,
          page_count: 14,
        }),
    }),
    text: () => Promise.resolve(JSON.stringify({ code: 'choose_pdf_mode' })),
    headers: new Headers({
      'Content-Type': 'application/json',
      'X-Upload-Owner': session,
    }),
  });

  const deckResponse = (headers: Record<string, string> = {}) => ({
    redirected: false,
    status: 200,
    headers: new Headers({
      'Content-Type': 'application/octet-stream',
      'File-Name': encodeURIComponent('scan.apkg'),
      'X-Card-Count': '7',
      ...headers,
    }),
    blob: () => Promise.resolve(new Blob(['apkg'])),
  });

  it('tells the server to ask for a PDF, but not for other files', async () => {
    const fetchMock = vi.fn().mockResolvedValue(choiceResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'scan.pdf');
    await submitForm(container);

    expect(sentFallback(fetchMock)).toBe('ask');
  });

  it('does not ask about files that cannot be a scanned PDF', async () => {
    const fetchMock = vi.fn().mockResolvedValue(deckResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'notes.md');
    await submitForm(container);

    expect(sentFallback(fetchMock)).toBeNull();
  });

  const noTextTitle = "We can't tell questions from answers in this PDF";
  const noTextBody =
    'It has text, but no clear question-and-answer split. Slides and scanned pages often look like this. Choose what the cards should be.';
  const singlePageNote = 'Each page became 1 card, as a picture of the page.';
  const pagePairsNote =
    'Every 2 pages became 1 card, as pictures of the pages.';

  const lockedCopy = {
    reason: 'locked',
    title: 'This PDF has no text we can read',
    body: "Its pages are likely scans or pictures, or the PDF is protected so its text can't be copied. Choose what the cards should be.",
  };

  const reasonCopy = [
    lockedCopy,
    { reason: 'no_text', title: noTextTitle, body: noTextBody },
    {
      reason: 'over_split',
      title: 'This PDF would make too many tiny cards',
      body: 'Its text breaks into lots of short lines. Choose what the cards should be instead.',
    },
  ];

  it.each(reasonCopy)(
    'says why a $reason PDF needs the question',
    async ({ reason, title, body }) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(choiceResponse(reason)));
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      selectFile(container, 'lecture.pdf');
      await submitForm(container);
      await screen.findByRole('button', { name: 'Two pages per card' });

      expect(screen.getByText(title, { selector: 'p' })).toBeInTheDocument();
      expect(screen.getByText(body)).toBeInTheDocument();
    }
  );

  it('gives a zip that holds a PDF the same reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue(choiceResponse('over_split'));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'lectures.zip');
    await submitForm(container);
    await screen.findByRole('button', { name: 'Two pages per card' });

    expect(sentFallback(fetchMock)).toBe('ask');
    expect(
      screen.getByText('This PDF would make too many tiny cards', {
        selector: 'p',
      })
    ).toBeInTheDocument();
  });

  it('asks once for a pick of several files, and resends every file with the choice', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(choiceResponse('over_split'))
      .mockResolvedValueOnce({
        redirected: false,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () =>
          Promise.resolve({
            kind: 'batch',
            workspaceId: 'ws-1',
            deckCount: 2,
            decks: [
              {
                name: 'slides',
                filename: 'slides.apkg',
                downloadUrl: '/download/ws-1/slides.apkg',
              },
              {
                name: 'notes',
                filename: 'notes.apkg',
                downloadUrl: '/download/ws-1/notes.apkg',
              },
            ],
            bulkUrl: '/download/ws-1/bulk',
          }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFiles(container, [
      new File(['%PDF'], 'slides.pdf', { type: 'application/pdf' }),
      new File(['# Notes'], 'notes.md', { type: 'text/markdown' }),
    ]);
    await submitForm(container);

    expect(sentFallback(fetchMock)).toBe('ask');
    expect(
      await screen.findByText('This PDF would make too many tiny cards', {
        selector: 'p',
      })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'One card per page' }));
    await screen.findAllByText('2 decks ready');

    const resend = fetchMock.mock.calls[1][1].body as FormData;
    expect(
      resend.getAll('pakker').map((entry) => (entry as File).name)
    ).toEqual(['slides.pdf', 'notes.md']);
    expect(sentFallback(fetchMock, 1)).toBe('single');
    expect(screen.queryByText(singlePageNote)).toBeNull();
  });

  it('names the page images when only the PDF in a pick of several files makes a deck', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(choiceResponse())
      .mockResolvedValueOnce(deckResponse({ 'X-Pdf-Fallback': 'pairs' }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFiles(container, [
      new File(['%PDF'], 'slides.pdf', { type: 'application/pdf' }),
      new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' }),
    ]);
    await submitForm(container);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Two pages per card' })
    );

    expect(await screen.findByText(pagePairsNote)).toBeInTheDocument();
    const resend = fetchMock.mock.calls[1][1].body as FormData;
    expect(
      resend.getAll('pakker').map((entry) => (entry as File).name)
    ).toEqual(['slides.pdf', 'photo.jpg']);
  });

  it('asks a signed-out visitor who continues past the AI preview without AI, and never previews again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        redirected: false,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/json',
          'X-Upload-Owner': 'none',
        }),
        json: () =>
          Promise.resolve({
            kind: 'ai_preview',
            cardCount: 1,
            cards: [{ front: 'What is osmosis?', back: 'Water moving' }],
          }),
      })
      .mockResolvedValueOnce(choiceResponse('no_text'))
      .mockResolvedValueOnce(deckResponse({ 'X-Pdf-Fallback': 'pairs' }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn />
    );
    selectFile(container, 'slides.pdf');
    await submitForm(container);
    expect(aiFlagFromFetch(fetchMock, '/api/upload/file')).toBe('true');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Continue without AI' })
    );

    expect(
      await screen.findByText(noTextTitle, { selector: 'p' })
    ).toBeInTheDocument();
    expect(screen.getByText(noTextBody)).toBeInTheDocument();
    const afterGate = fetchMock.mock.calls[1][1].body as FormData;
    expect(afterGate.get('claude-ai-flashcards')).toBe('false');
    expect(afterGate.get('pdf-fallback')).toBe('ask');

    fireEvent.click(screen.getByRole('button', { name: 'Two pages per card' }));

    expect(await screen.findByText(pagePairsNote)).toBeInTheDocument();
    const afterChoice = fetchMock.mock.calls[2][1].body as FormData;
    expect(afterChoice.get('claude-ai-flashcards')).toBe('false');
    expect(afterChoice.get('pdf-fallback')).toBe('pairs');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    { who: 'a free account', locals: { subscriber: false }, aiButton: false },
    {
      who: 'a pass holder',
      locals: { subscriber: true, passKind: '120d' },
      aiButton: true,
    },
  ])(
    'gives $who the same reason above the choices',
    async ({ locals, aiButton }) => {
      mockUseUserLocals.mockReturnValue({
        data: { user: { id: 7 }, locals },
        isLoading: false,
        error: null,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useUserLocals>);
      mockGet2ankiApi.mockReturnValue({
        startPassCheckout: vi.fn(),
        getUploads: vi.fn().mockResolvedValue([]),
        getHeldDeck: vi.fn().mockResolvedValue(null),
      } as unknown as ReturnType<typeof get2ankiApi>);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(choiceResponse('no_text', '7'))
      );
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      selectFile(container, 'lecture.pdf');
      await submitForm(container);
      await screen.findByRole('button', { name: 'Two pages per card' });

      expect(
        screen.getByText(noTextTitle, { selector: 'p' })
      ).toBeInTheDocument();
      expect(screen.getByText(noTextBody)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Make cards with AI' }) != null
      ).toBe(aiButton);
    }
  );

  it.each(reasonCopy)(
    'announces why a $reason PDF needs the question to screen readers',
    async ({ reason, title }) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(choiceResponse(reason)));
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      selectFile(container, 'lecture.pdf');
      await submitForm(container);
      await screen.findByRole('button', { name: 'Two pages per card' });

      expect(container.querySelector('output')?.textContent).toBe(title);
    }
  );

  it.each(reasonCopy)(
    'reports the $reason question, and the pick made on it',
    async ({ reason }) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(choiceResponse(reason))
          .mockResolvedValueOnce(deckResponse({ 'X-Pdf-Fallback': 'pairs' }))
      );
      const trackMock = vi.mocked(track);
      trackMock.mockClear();
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      selectFile(container, 'lecture.pdf');
      await submitForm(container);
      fireEvent.click(
        await screen.findByRole('button', { name: 'Two pages per card' })
      );
      await screen.findByText(pagePairsNote);

      expect(trackMock).toHaveBeenCalledWith('pdf_fallback_choice_shown', {
        reason,
        pageBucket: '11-50',
      });
      expect(trackMock).toHaveBeenCalledWith('pdf_fallback_chosen', {
        mode: 'pairs',
        reason,
        remembered: false,
      });
    }
  );

  it.each([
    {
      usage: 'loading',
      cardUsage: {
        cards_used: 0,
        cards_limit: 100,
        unlimited: false,
        loading: true,
      },
    },
    {
      // What useCardUsage reports when its request fails.
      usage: 'unavailable',
      cardUsage: {
        cards_used: 0,
        cards_limit: 100,
        unlimited: false,
        loading: false,
      },
    },
  ])(
    'asks a free account over its limit while its card usage is $usage',
    async ({ cardUsage }) => {
      mockUseUserLocals.mockReturnValue({
        data: { user: { id: 7 }, locals: { subscriber: false } },
        isLoading: false,
        error: null,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useUserLocals>);
      mockGet2ankiApi.mockReturnValue({
        startPassCheckout: vi.fn(),
        getUploads: vi.fn().mockResolvedValue([]),
        getHeldDeck: vi.fn().mockResolvedValue(null),
      } as unknown as ReturnType<typeof get2ankiApi>);
      mockUseCardUsage.mockReturnValue(cardUsage);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(choiceResponse('no_text', '7'))
      );
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      expect(
        (container.querySelector('#pakker') as HTMLInputElement).disabled
      ).toBe(false);
      selectFile(container, 'lecture.pdf');
      await submitForm(container);
      await screen.findByRole('button', { name: 'Two pages per card' });

      expect(
        screen.getByText(noTextTitle, { selector: 'p' })
      ).toBeInTheDocument();
      expect(screen.getByText(noTextBody)).toBeInTheDocument();
    }
  );

  it('asks a signed-out visitor with AI on when the AI preview has nothing to show', async () => {
    const fetchMock = vi.fn().mockResolvedValue(choiceResponse('locked'));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} aiOn />
    );
    selectFile(container, 'scan.pdf');
    await submitForm(container);
    await screen.findByRole('button', { name: 'Two pages per card' });

    const sent = fetchMock.mock.calls[0][1].body as FormData;
    expect(sent.get('claude-ai-flashcards')).toBe('true');
    expect(sent.get('pdf-fallback')).toBe('ask');
    expect(
      screen.getByText(lockedCopy.title, { selector: 'p' })
    ).toBeInTheDocument();
    expect(screen.getByText(lockedCopy.body)).toBeInTheDocument();
  });

  it.each([
    {
      ai: 'off',
      aiFlag: 'false',
      deckHeaders: { 'X-Pdf-Fallback': 'pairs' },
      noteShown: true,
    },
    // Claude wrote that deck, so the server sends no X-Pdf-Fallback.
    {
      ai: 'on',
      aiFlag: 'true',
      deckHeaders: {} as Record<string, string>,
      noteShown: false,
    },
  ])(
    'asks a pass holder without an account, with AI $ai, and names page images only on a deck of them',
    async ({ aiFlag, deckHeaders, noteShown }) => {
      storePassToken('cs_pass');
      globalThis.localStorage.setItem('claude-ai-flashcards', aiFlag);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(choiceResponse())
        .mockResolvedValueOnce(deckResponse(deckHeaders));
      vi.stubGlobal('fetch', fetchMock);
      const { container } = renderUploadForm(
        <UploadForm setErrorMessage={vi.fn()} />
      );
      selectFile(container, 'slides.pdf');
      await submitForm(container);
      expect(
        await screen.findByText(noTextTitle, { selector: 'p' })
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', { name: 'Two pages per card' })
      );
      await waitFor(() =>
        expect(container.querySelector('output')?.textContent).toBe(
          'Your deck is ready — 7 cards.'
        )
      );

      const resend = fetchMock.mock.calls[1][1];
      expect(resend.headers).toMatchObject({ 'X-Pass-Token': 'cs_pass' });
      expect((resend.body as FormData).get('claude-ai-flashcards')).toBe(
        aiFlag
      );
      expect(sentFallback(fetchMock, 1)).toBe('pairs');
      expect(screen.queryByText(pagePairsNote) != null).toBe(noteShown);
    }
  );

  it('offers the choices, and resends the same file with the one picked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(choiceResponse())
      .mockResolvedValueOnce(deckResponse({ 'X-Pdf-Fallback': 'single' }));
    vi.stubGlobal('fetch', fetchMock);
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'scan.pdf');
    await submitForm(container);

    expect(
      await screen.findByText(noTextTitle, { selector: 'p' })
    ).toBeInTheDocument();
    const pairs = screen.getByRole('button', { name: 'Two pages per card' });
    const single = screen.getByRole('button', { name: 'One card per page' });
    expect(
      pairs.compareDocumentPosition(single) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.queryByRole('button', { name: 'Make cards with AI' })
    ).toBeNull();
    expect(trackMock).toHaveBeenCalledWith('pdf_fallback_choice_shown', {
      reason: 'no_text',
      pageBucket: '11-50',
    });

    fireEvent.click(single);

    expect(await screen.findByText(singlePageNote)).toBeInTheDocument();
    expect(trackMock).toHaveBeenCalledWith('pdf_fallback_chosen', {
      mode: 'single',
      reason: 'no_text',
      remembered: false,
    });
    expect(sentFallback(fetchMock, 1)).toBe('single');
    const second = fetchMock.mock.calls[1][1].body as FormData;
    expect((second.get('pakker') as File).name).toBe('scan.pdf');
    expect(globalThis.localStorage.getItem('pdf-fallback')).toBeNull();
  });

  it('remembers the choice when asked, and uses it without asking again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(choiceResponse())
      .mockResolvedValueOnce(deckResponse({ 'X-Pdf-Fallback': 'pairs' }));
    vi.stubGlobal('fetch', fetchMock);
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'scan.pdf');
    await submitForm(container);
    await screen.findByText(noTextTitle, { selector: 'p' });

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Remember my choice on this device',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Two pages per card' }));

    await screen.findByText(pagePairsNote);
    expect(trackMock).toHaveBeenCalledWith('pdf_fallback_chosen', {
      mode: 'pairs',
      reason: 'no_text',
      remembered: true,
    });
    expect(globalThis.localStorage.getItem('pdf-fallback')).toBe('pairs');
    expect(
      screen.getByRole('button', { name: 'Ask me next time' })
    ).toBeInTheDocument();
  });

  it('sends a remembered choice instead of asking', async () => {
    globalThis.localStorage.setItem('pdf-fallback', 'single');
    const fetchMock = vi.fn().mockResolvedValue(deckResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'scan.pdf');
    await submitForm(container);

    expect(sentFallback(fetchMock)).toBe('single');
  });

  it('says what a remembered choice made, without asking first', async () => {
    globalThis.localStorage.setItem('pdf-fallback', 'pairs');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(deckResponse({ 'X-Pdf-Fallback': 'pairs' }))
    );
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'slides.pdf');
    await submitForm(container);

    expect(await screen.findByText(pagePairsNote)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Two pages per card' })
    ).toBeNull();
  });

  it('says what a Dropbox PDF made, without asking first', async () => {
    vi.stubEnv('REACT_APP_DROPBOX_APP_KEY', 'test-key');
    vi.stubGlobal('Dropbox', {
      choose: ({ success }: { success: (files: unknown[]) => void }) => {
        success([
          {
            id: 'id:1',
            name: 'slides.pdf',
            bytes: 200,
            icon: 'page_white_acrobat',
            isDir: false,
            link: 'https://dl.dropboxusercontent.com/x/slides.pdf',
            linkType: 'direct',
          },
        ]);
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(deckResponse({ 'X-Pdf-Fallback': 'pairs' }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    const chooser = container.querySelector(
      'button[aria-label="Choose from Dropbox"]'
    ) as HTMLButtonElement;
    await act(async () => {
      chooser.click();
    });

    expect(await screen.findByText(pagePairsNote)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => url === '/api/upload/dropbox')
    ).toBe(true);
    expect(
      screen.queryByRole('button', { name: 'Two pages per card' })
    ).toBeNull();
  });

  it('lets the person take a remembered choice back', async () => {
    globalThis.localStorage.setItem('pdf-fallback', 'single');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(deckResponse({ 'X-Pdf-Fallback': 'single' }));
    vi.stubGlobal('fetch', fetchMock);
    const trackMock = vi.mocked(track);
    trackMock.mockClear();
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    selectFile(container, 'scan.pdf');
    await submitForm(container);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Ask me next time' })
    );

    expect(globalThis.localStorage.getItem('pdf-fallback')).toBeNull();
    expect(trackMock).toHaveBeenCalledWith('pdf_fallback_forgotten');
    expect(
      screen.queryByRole('button', { name: 'Ask me next time' })
    ).toBeNull();
  });
});

describe('UploadForm thin deck resume after the Day Pass checkout', () => {
  beforeEach(() => {
    mockUseUserLocals.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>);
  });

  afterEach(() => {
    clearThinDeckResume();
    globalThis.localStorage.removeItem('2anki_pass_token');
    vi.unstubAllGlobals();
  });

  async function saveWithAi(ownerId: number | null) {
    await getPendingUploadStore().save({
      files: [new File(['x'], 'lecture.pdf', { type: 'application/pdf' })],
      filename: 'lecture.pdf',
      sizeBytes: 1,
      submittedAt: Date.now(),
      recoveryToken: null,
      ownerId,
      pdfPageRange: null,
      aiFlag: 'true',
    });
  }

  function stubSignedInReturn(): void {
    vi.stubGlobal('location', {
      search: '?from=pass&session_id=cs_thin',
      href: 'http://localhost/upload?from=pass&session_id=cs_thin',
      origin: 'http://localhost',
    });
  }

  function signedIn(paying: boolean) {
    return {
      data: {
        user: { id: 7 },
        locals: { patreon: false, subscriber: paying },
        features: {},
      },
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUserLocals>;
  }

  test('sends the saved file again with AI on for a visitor back from checkout', async () => {
    stubPassReturn('cs_thin');
    markThinDeckResume();
    await saveWithAi(null);
    const resumeAiPreview = vi.fn();
    const restore = installResumeApi(resumeAiPreview);
    const fetchMock = okApkgFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);

      await waitFor(() =>
        expect(aiFlagFromFetch(fetchMock, '/api/upload/file')).toBe('true')
      );
      const body = fetchMock.mock.calls[0][1].body as FormData;
      expect((body.get('pakker') as File).name).toBe('lecture.pdf');
      expect(body.getAll('kept-owner')).toEqual(['none']);
      expect(resumeAiPreview).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test('sends nothing for a signed in buyer until the account shows as paying', async () => {
    stubSignedInReturn();
    markThinDeckResume();
    await saveWithAi(7);
    mockUseUserLocals.mockReturnValue(signedIn(false));
    const fetchMock = okApkgFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled();

    mockUseUserLocals.mockReturnValue(signedIn(true));
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <UploadForm setErrorMessage={vi.fn()} />
        </QueryClientProvider>
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(aiFlagFromFetch(fetchMock, '/api/upload/file')).toBe('true')
    );
  });

  test('does not send a file saved by another account', async () => {
    stubSignedInReturn();
    markThinDeckResume();
    await saveWithAi(99);
    mockUseUserLocals.mockReturnValue(signedIn(true));
    const fetchMock = okApkgFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does not resume a return from checkout that did not start from the offer', async () => {
    stubSignedInReturn();
    await saveWithAi(7);
    mockUseUserLocals.mockReturnValue(signedIn(true));
    const fetchMock = okApkgFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('keeps asking until the account pays, then gives up after the wait and clears the marker', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubSignedInReturn();
      markThinDeckResume();
      await saveWithAi(7);
      const refetch = vi.fn();
      mockUseUserLocals.mockReturnValue({
        ...signedIn(false),
        refetch,
      } as unknown as ReturnType<typeof useUserLocals>);
      const fetchMock = okApkgFetch();
      vi.stubGlobal('fetch', fetchMock);

      renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      expect(refetch.mock.calls.length).toBeGreaterThan(5);
      expect(thinDeckResumeMarked()).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(THIN_DECK_RESUME_WAIT_MS).toBeLessThanOrEqual(40_000);
    } finally {
      vi.useRealTimers();
    }
  });

  test('keeps asking while the account reads fail, then sends the saved file once when the pass shows', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubSignedInReturn();
      markThinDeckResume();
      await saveWithAi(7);
      const trackMock = vi.mocked(track);
      trackMock.mockClear();
      const answers = [
        { ...signedIn(false), error: new Error('locals'), isError: true },
        { ...signedIn(false), error: new Error('locals'), isError: true },
        signedIn(true),
      ];
      let current: ReturnType<typeof useUserLocals> = signedIn(false);
      const refetch = vi.fn(async () => {
        current = (answers.shift() ?? current) as unknown as ReturnType<
          typeof useUserLocals
        >;
      });
      mockUseUserLocals.mockImplementation(
        () =>
          ({ ...current, refetch }) as unknown as ReturnType<
            typeof useUserLocals
          >
      );
      const fetchMock = okApkgFetch();
      vi.stubGlobal('fetch', fetchMock);

      renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      expect(refetch).toHaveBeenCalledTimes(3);
      expect(aiFlagFromFetch(fetchMock, '/api/upload/file')).toBe('true');
      expect(
        trackMock.mock.calls.filter(
          ([name]) => name === 'thin_deck_ai_unlock_clicked'
        )
      ).toEqual([['thin_deck_ai_unlock_clicked', { plan: 'resumed' }]]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('sends nothing and asks nothing again when the first account read fails on the way back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubSignedInReturn();
      markThinDeckResume();
      await saveWithAi(7);
      const refetch = vi.fn();
      mockUseUserLocals.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('locals'),
        isError: true,
        refetch,
      } as unknown as ReturnType<typeof useUserLocals>);
      const fetchMock = okApkgFetch();
      vi.stubGlobal('fetch', fetchMock);

      renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      expect(refetch).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await getPendingUploadStore().load()).toMatchObject({
        ownerId: 7,
        aiFlag: 'true',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test('drops a marker left behind when the page is not a return from checkout', async () => {
    markThinDeckResume();
    await saveWithAi(null);
    vi.stubGlobal('fetch', okApkgFetch());

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);

    await waitFor(() => expect(thinDeckResumeMarked()).toBe(false));
  });
});

describe('UploadForm last deck for a signed-out pass holder', () => {
  const TOKEN = '0b6f2c1e-3a4d-4e5f-8a9b-1c2d3e4f5a6b';
  const signedOutVisitor = {
    user: null,
    locals: { owner: 0, patreon: false, subscriber: false },
    features: {},
  } as unknown as ReturnType<typeof useUserLocals>['data'];
  const signedInVisitor = {
    user: { id: 8, email: 'free@example.com' },
    locals: { owner: 8, patreon: false, subscriber: false },
    features: {},
  } as unknown as ReturnType<typeof useUserLocals>['data'];
  const trackMock = vi.mocked(track);

  function showVisitor(data: ReturnType<typeof useUserLocals>['data']) {
    mockUseUserLocals.mockReturnValue({
      data,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi
        .fn()
        .mockResolvedValue({ data, status: 'success', isError: false }),
    } as unknown as ReturnType<typeof useUserLocals>);
  }

  function stubRecovery(getAnonymousRecoveredDeck: Mock) {
    mockGet2ankiApi.mockReturnValue({
      startPassCheckout: vi.fn(),
      getUploads: vi.fn().mockResolvedValue([]),
      getHeldDeck: vi.fn().mockResolvedValue(null),
      getAnonymousRecoveredDeck,
    } as unknown as ReturnType<typeof get2ankiApi>);
  }

  async function keepDeck() {
    await getLastDeckStore().save({
      recoveryToken: TOKEN,
      deckName: 'Biology.apkg',
      savedAt: Date.now(),
    });
  }

  function deckResponse(): Mock {
    return vi.fn().mockResolvedValue({
      redirected: false,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'File-Name': 'Biology.apkg',
        'X-Card-Count': '120',
      }),
      blob: () => Promise.resolve(new Blob(['apkg'])),
    });
  }

  async function uploadFile(container: HTMLElement) {
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['x'], 'biology.html', { type: 'text/html' })],
      configurable: true,
    });
    fileInput.removeAttribute('required');
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
    });
  }

  function sentRecoveryToken(fetchMock: Mock): string | undefined {
    const call = fetchMock.mock.calls.find(
      ([url]) => url === '/api/upload/file'
    );
    const headers = call?.[1]?.headers as Record<string, string> | undefined;
    return headers?.['X-Recovery-Token'];
  }

  beforeEach(() => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:last-deck');
    globalThis.URL.revokeObjectURL = vi.fn();
    trackMock.mockClear();
  });

  afterEach(() => {
    globalThis.localStorage.removeItem('2anki_pass_token');
    mockUseUserLocals.mockReset();
    mockGet2ankiApi.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetLastDeckStoreForTests();
  });

  it('keeps the deck of a signed-out upload that used a pass', async () => {
    showVisitor(signedOutVisitor);
    stubRecovery(vi.fn());
    globalThis.localStorage.setItem('2anki_pass_token', 'cs_pass');
    const fetchMock = deckResponse();
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await uploadFile(container);

    await waitFor(async () =>
      expect(await getLastDeckStore().load()).toMatchObject({
        recoveryToken: sentRecoveryToken(fetchMock),
        deckName: 'Biology.apkg',
      })
    );
  });

  it('keeps the deck of a pass upload made on a sample form, without offering it there', async () => {
    showVisitor(signedOutVisitor);
    stubRecovery(vi.fn());
    globalThis.localStorage.setItem('2anki_pass_token', 'cs_pass');
    const fetchMock = deckResponse();
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} sample />
    );
    await uploadFile(container);

    await waitFor(async () =>
      expect(await getLastDeckStore().load()).toMatchObject({
        recoveryToken: sentRecoveryToken(fetchMock),
        deckName: 'Biology.apkg',
      })
    );
    expect(
      screen.queryByText(/can be downloaded again until/)
    ).not.toBeInTheDocument();
  });

  it('keeps nothing for a signed-out upload without a pass', async () => {
    showVisitor(signedOutVisitor);
    stubRecovery(vi.fn());
    vi.stubGlobal('fetch', deckResponse());

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await uploadFile(container);

    expect(
      (await screen.findAllByText(/Your deck is ready/)).length
    ).toBeGreaterThan(0);
    expect(await getLastDeckStore().load()).toBeNull();
  });

  it('offers the last deck on the idle drop zone while signed out', async () => {
    showVisitor(signedOutVisitor);
    stubRecovery(vi.fn());
    await keepDeck();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);

    expect(
      await screen.findByText(/can be downloaded again until/)
    ).toHaveTextContent(/^Your last deck, Biology, can be downloaded again/);
    expect(
      screen.getByRole('button', { name: 'Download' })
    ).toHaveAccessibleDescription(/^Your last deck, Biology,/);
  });

  it('offers nothing on the sample form of the home page', async () => {
    showVisitor(signedOutVisitor);
    stubRecovery(vi.fn());
    await keepDeck();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} sample />);
    await act(async () => {
      expect(await getLastDeckStore().load()).toMatchObject({
        recoveryToken: TOKEN,
      });
    });

    expect(
      screen.queryByText(/can be downloaded again until/)
    ).not.toBeInTheDocument();
  });

  it('keeps and offers the deck when the stored pass had already expired', async () => {
    showVisitor(signedOutVisitor);
    stubRecovery(vi.fn());
    globalThis.localStorage.setItem('2anki_pass_token', 'cs_expired');
    const fetchMock = deckResponse();
    vi.stubGlobal('fetch', fetchMock);

    const first = renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    await uploadFile(first.container);
    await waitFor(async () =>
      expect(await getLastDeckStore().load()).toMatchObject({
        recoveryToken: sentRecoveryToken(fetchMock),
      })
    );
    first.unmount();
    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);

    expect(
      await screen.findByText(/can be downloaded again until/)
    ).toHaveTextContent(/^Your last deck, Biology,/);
  });

  it('offers nothing once the visitor is signed in', async () => {
    showVisitor(signedInVisitor);
    stubRecovery(vi.fn());
    await keepDeck();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    await act(async () => {
      expect(await getLastDeckStore().load()).toMatchObject({
        recoveryToken: TOKEN,
      });
    });

    expect(
      screen.queryByText(/can be downloaded again until/)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Download' })
    ).not.toBeInTheDocument();
  });

  it('fetches the stored deck and starts the download', async () => {
    showVisitor(signedOutVisitor);
    const getAnonymousRecoveredDeck = vi
      .fn()
      .mockResolvedValue(new Blob(['apkg']));
    stubRecovery(getAnonymousRecoveredDeck);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await keepDeck();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(getAnonymousRecoveredDeck).toHaveBeenCalledWith(TOKEN);
    expect(trackMock).toHaveBeenCalledWith('anon_deck_refetched', {
      outcome: 'downloaded',
    });
  });

  it('removes the line and the record when the deck is gone', async () => {
    showVisitor(signedOutVisitor);
    stubRecovery(vi.fn().mockResolvedValue(null));
    const setErrorMessage = vi.fn();
    await keepDeck();

    renderUploadForm(<UploadForm setErrorMessage={setErrorMessage} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));

    const gone = await screen.findByText(
      'That deck is no longer stored. Upload the file again.'
    );
    expect(
      screen.queryByText(/can be downloaded again until/)
    ).not.toBeInTheDocument();
    expect(gone).toHaveFocus();
    expect(await getLastDeckStore().load()).toBeNull();
    expect(trackMock).toHaveBeenCalledWith('anon_deck_refetched', {
      outcome: 'expired',
    });
    expect(setErrorMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the deck and says the download did not start on a network error', async () => {
    showVisitor(signedOutVisitor);
    stubRecovery(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await keepDeck();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));

    expect(
      await screen.findByText(
        "The download didn't start. Check your connection and try again."
      )
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Download' })).toHaveFocus()
    );
    expect(trackMock).toHaveBeenCalledWith('anon_deck_refetched', {
      outcome: 'failed',
    });
    expect(await getLastDeckStore().load()).toMatchObject({
      recoveryToken: TOKEN,
    });
  });

  it('keeps the deck and says it cannot be downloaded when the server refuses', async () => {
    showVisitor(signedOutVisitor);
    stubRecovery(vi.fn().mockRejectedValue(new RecoveryUnavailableError(403)));
    await keepDeck();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));

    expect(
      await screen.findByText(
        "Couldn't download the deck right now. Try again later."
      )
    ).toBeInTheDocument();
    expect(await getLastDeckStore().load()).toMatchObject({
      recoveryToken: TOKEN,
    });
    expect(trackMock).toHaveBeenCalledWith('anon_deck_refetched', {
      outcome: 'unavailable',
    });
  });

  it('keeps the deck when the download breaks part-way through', async () => {
    showVisitor(signedOutVisitor);
    stubRecovery(vi.fn().mockResolvedValue(null));
    globalThis.localStorage.setItem('2anki_pass_token', 'cs_pass');
    const fetchMock = vi.fn().mockResolvedValue({
      redirected: false,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'File-Name': 'Biology.apkg',
        'X-Card-Count': '120',
      }),
      blob: () => Promise.reject(new TypeError('network error')),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    await uploadFile(container);

    await waitFor(async () =>
      expect(await getLastDeckStore().load()).toMatchObject({
        recoveryToken: sentRecoveryToken(fetchMock),
        deckName: 'Biology.apkg',
      })
    );
  });

  it('says storage is busy when the server answers 503', async () => {
    showVisitor(signedOutVisitor);
    stubRecovery(vi.fn().mockRejectedValue(new RecoveryStorageBusyError()));
    await keepDeck();

    renderUploadForm(<UploadForm setErrorMessage={vi.fn()} />);
    const download = await screen.findByRole('button', { name: 'Download' });
    const status = download.parentElement!.querySelector('[role="status"]');
    expect(status).toBeEmptyDOMElement();
    fireEvent.click(download);

    await waitFor(() =>
      expect(status).toHaveTextContent(
        'Storage is busy right now. Try the download again in a moment.'
      )
    );
    await waitFor(() => expect(download).toHaveFocus());
    expect(trackMock).toHaveBeenCalledWith('anon_deck_refetched', {
      outcome: 'busy',
    });
    expect(await getLastDeckStore().load()).toMatchObject({
      recoveryToken: TOKEN,
    });
  });
});

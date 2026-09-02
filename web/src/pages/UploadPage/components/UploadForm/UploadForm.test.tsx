import {
  render,
  act,
  waitFor,
  fireEvent,
  screen,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import UploadForm from './UploadForm';

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

vi.mock('../../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: vi.fn(() => ({
    startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
  })),
}));

vi.mock('../../../../lib/hooks/useCardUsage', () => ({
  useCardUsage: vi.fn(() => null),
  CARD_USAGE_QUERY_KEY: ['cardUsage'],
}));

import { useUserLocals } from '../../../../lib/hooks/useUserLocals';
import { useCardUsage } from '../../../../lib/hooks/useCardUsage';
import { get2ankiApi } from '../../../../lib/backend/get2ankiApi';
import { track } from '../../../../lib/analytics/track';

const mockUseUserLocals = vi.mocked(useUserLocals);
const mockUseCardUsage = vi.mocked(useCardUsage);
const mockGet2ankiApi = vi.mocked(get2ankiApi);

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

describe('UploadForm', () => {
  test('no null classes', () => {
    const { container } = renderUploadForm(
      <UploadForm setErrorMessage={vi.fn()} />
    );
    expect(container.querySelector('.null')).toBeNull();
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
});

describe('UploadForm analytics events', () => {
  beforeEach(() => {
    (globalThis as AnalyticsGlobals).gtag = vi.fn();
    (globalThis as AnalyticsGlobals).hj = vi.fn();
  });

  afterEach(() => {
    delete (globalThis as AnalyticsGlobals).gtag;
    delete (globalThis as AnalyticsGlobals).hj;
    vi.restoreAllMocks();
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

  it('redirects an apkg-reject error to /print with the PDF CTA', async () => {
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
      expect(container.textContent).toMatch(/That's already an Anki deck/);
    });

    const print = container.querySelector('a[href="/print"]');
    expect(container.querySelector('a[href="/transform"]')).toBeNull();
    expect(print?.textContent).toMatch(/Print as PDF/);
    expect(container.textContent).toMatch(
      /Export your deck as a printable PDF/
    );
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

  it('routes a 400 with code=image_only_no_text into the Photo to Deck handoff', async () => {
    const jsonBody = {
      code: 'image_only_no_text',
      message:
        'These look like images — no text to read. Turn them into cards with Photo to Deck.',
      filename: 'lecture-page.png',
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
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    const cta = await screen.findByRole('link', { name: /Try Photo to Deck/i });
    expect(cta).toHaveAttribute('href', '/photo-to-deck');
    expect(container.querySelector('[class*="errorBody"]')).toBeNull();
  });

  it('fires image_only_photo_deck_clicked when the handoff CTA is clicked', async () => {
    const { track } = await import('../../../../lib/analytics/track');
    const trackMock = vi.mocked(track);
    trackMock.mockClear();

    const jsonBody = {
      code: 'image_only_no_text',
      message:
        'These look like images — no text to read. Turn them into cards with Photo to Deck.',
      filename: 'lecture-page.png',
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
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    const cta = await screen.findByRole('link', { name: /Try Photo to Deck/i });
    fireEvent.click(cta);

    expect(trackMock).toHaveBeenCalledWith('image_only_photo_deck_shown');
    expect(trackMock).toHaveBeenCalledWith('image_only_photo_deck_clicked');
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
        "Your download didn't finish — the deck is saved to your downloads."
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

  function stubLimitFetch(kind: 'file_size' | 'card_count' = 'file_size') {
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

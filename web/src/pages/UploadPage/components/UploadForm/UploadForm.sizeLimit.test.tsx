import {
  act,
  render,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import UploadForm from './UploadForm';
import { track } from '../../../../lib/analytics/track';
import { useUserLocals } from '../../../../lib/hooks/useUserLocals';
import { clearPassToken, storePassToken } from '../../../../lib/anonymousPass';
import { resetPendingUploadStoreForTests } from '../../../../lib/upload/pendingUpload';
import { resetLastDeckStoreForTests } from '../../../../lib/upload/lastDeck';
import {
  PDF_UNLOCK_MAX_BYTES,
  UPLOAD_FILE_FREE_MAX_BYTES,
  UPLOAD_FILE_PAYING_MAX_BYTES,
} from '../../../../lib/upload/uploadSizeLimits';

vi.mock('../../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

vi.mock('../../../../lib/hooks/useUserLocals', () => ({
  useUserLocals: vi.fn(),
}));

vi.mock('../../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: vi.fn(() => ({
    startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
    getUploads: vi.fn().mockResolvedValue([]),
    getHeldDeck: vi.fn().mockResolvedValue(null),
    getCheckoutPrices: vi.fn().mockResolvedValue(null),
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

type Locals = ReturnType<typeof useUserLocals>['data'];

const signedInFree = {
  user: { id: 1 },
  locals: { owner: 1, patreon: false, subscriber: false },
  features: {},
} as unknown as Locals;

const signedOut = {
  user: null,
  locals: { owner: 0, patreon: false, subscriber: false },
  features: {},
} as unknown as Locals;

const paying = {
  user: { id: 7 },
  locals: { owner: 7, patreon: false, subscriber: true },
  features: {},
} as unknown as Locals;

const freshRead = (data: Locals) => ({ status: 'success', data });

function setLocals(
  data: Locals,
  state: { isLoading?: boolean; isError?: boolean; refetch?: Mock } = {}
): Mock {
  const refetch = state.refetch ?? vi.fn().mockResolvedValue(freshRead(data));
  vi.mocked(useUserLocals).mockReturnValue({
    data,
    isLoading: state.isLoading ?? false,
    error: null,
    isError: state.isError ?? false,
    refetch,
  } as unknown as ReturnType<typeof useUserLocals>);
  return refetch;
}

function controlledRead() {
  let answer: (value: unknown) => void = () => {};
  const refetch = vi.fn(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      })
  );
  return { refetch, answer: (value: unknown) => answer(value) };
}

function fileOfSize(name: string, size: number): File {
  const file = new File(['x'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function deckResponse() {
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

function stubServer(): Mock {
  const fetchMock = vi.fn((url: string) =>
    url === '/api/upload/file'
      ? Promise.resolve(deckResponse())
      : Promise.resolve(new Response(null, { status: 204 }))
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const uploadsSent = (fetchMock: Mock) =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/upload/file');

function renderForm(
  initialEntries?: Parameters<typeof MemoryRouter>[0]['initialEntries']
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function fileInputOf(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

async function pickAndSubmit(container: HTMLElement, files: File[]) {
  const input = fileInputOf(container);
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.removeAttribute('required');
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function drop(container: HTMLElement, files: File[]) {
  const input = fileInputOf(container);
  Object.defineProperty(input, 'files', {
    value: null,
    writable: true,
    configurable: true,
  });
  input.removeAttribute('required');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { items: [], files },
  });
  await act(async () => {
    document.body.dispatchEvent(event);
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

const OVER_FREE_TITLE = 'This file is over the 100 MB limit';

beforeEach(() => {
  resetPendingUploadStoreForTests();
  resetLastDeckStoreForTests();
  vi.mocked(track).mockClear();
  globalThis.localStorage.clear();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:deck');
});

afterEach(() => {
  clearPassToken();
  vi.unstubAllGlobals();
});

describe('UploadForm refuses a file over the upload limit before sending it', () => {
  it('does not send a file one byte over the free limit when a fresh account read still says free', async () => {
    const refetch = setLocals(signedInFree);
    const fetchMock = stubServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [
      fileOfSize('lecture.pdf', UPLOAD_FILE_FREE_MAX_BYTES + 1),
    ]);

    expect(await screen.findByText(OVER_FREE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(/lecture\.pdf/)).toBeInTheDocument();
    await settle();
    expect(uploadsSent(fetchMock)).toEqual([]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('sends a file exactly at the free limit without reading the account again', async () => {
    const refetch = setLocals(signedInFree);
    const fetchMock = stubServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [
      fileOfSize('lecture.pdf', UPLOAD_FILE_FREE_MAX_BYTES),
    ]);

    await waitFor(() => expect(uploadsSent(fetchMock)).toHaveLength(1));
    expect(screen.queryByText(OVER_FREE_TITLE)).toBeNull();
    expect(refetch).not.toHaveBeenCalled();
  });

  it('tells a signed-out visitor the limit without sending the file', async () => {
    setLocals(signedOut);
    const fetchMock = stubServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [
      fileOfSize('lecture.pdf', UPLOAD_FILE_FREE_MAX_BYTES + 1),
    ]);

    expect(await screen.findByText(OVER_FREE_TITLE)).toBeInTheDocument();
    expect(
      screen.getByText(/Files over 100 MB need a paid plan\./)
    ).toBeInTheDocument();
    await settle();
    expect(uploadsSent(fetchMock)).toEqual([]);
  });

  it('refuses a whole drop when one of its files is over the limit, naming that file', async () => {
    setLocals(signedInFree);
    const fetchMock = stubServer();
    const { container } = renderForm();

    await drop(container, [
      fileOfSize('notes.pdf', 1024),
      fileOfSize('scans.pdf', UPLOAD_FILE_FREE_MAX_BYTES + 1),
    ]);

    expect(await screen.findByText(OVER_FREE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(/scans\.pdf/)).toBeInTheDocument();
    expect(screen.queryByText(/notes\.pdf/)).toBeNull();
    await settle();
    expect(uploadsSent(fetchMock)).toEqual([]);
  });

  it('sends a drop whose files are all within the limit', async () => {
    setLocals(signedInFree);
    const fetchMock = stubServer();
    const { container } = renderForm();

    await drop(container, [
      fileOfSize('notes.pdf', 1024),
      fileOfSize('scans.pdf', UPLOAD_FILE_FREE_MAX_BYTES),
    ]);

    await waitFor(() => expect(uploadsSent(fetchMock)).toHaveLength(1));
  });

  it('does not send a zip handed over from Print or CSV when it is over the limit', async () => {
    setLocals(signedInFree);
    const fetchMock = stubServer();
    const notes = fileOfSize('notes.zip', UPLOAD_FILE_FREE_MAX_BYTES + 1);

    renderForm([{ pathname: '/upload', state: { handoffFile: notes } }]);

    expect(await screen.findByText(OVER_FREE_TITLE)).toBeInTheDocument();
    await settle();
    expect(uploadsSent(fetchMock)).toEqual([]);
  });

  it('records no upload as submitted or failed when it refuses the file', async () => {
    setLocals(signedInFree);
    stubServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [
      fileOfSize('lecture.pdf', UPLOAD_FILE_FREE_MAX_BYTES + 1),
    ]);
    await screen.findByText(OVER_FREE_TITLE);

    const names = vi.mocked(track).mock.calls.map(([name]) => name);
    expect(names).not.toContain('upload_submitted');
    expect(names).not.toContain('upload_failed');
  });

  it.each([
    ['a paying account', () => setLocals(paying)],
    [
      'a signed-out pass holder',
      () => {
        storePassToken('cs_pass');
        setLocals(signedOut);
      },
    ],
    [
      'a page still reading the account',
      () => setLocals(undefined, { isLoading: true }),
    ],
    [
      'a page whose account read failed',
      () => setLocals(undefined, { isError: true }),
    ],
  ])('sends a file over the free limit for %s', async (_who, arrange) => {
    arrange();
    const fetchMock = stubServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [
      fileOfSize('lecture.pdf', UPLOAD_FILE_FREE_MAX_BYTES + 1),
    ]);

    await waitFor(() => expect(uploadsSent(fetchMock)).toHaveLength(1));
  });

  it('does not send a file over the paid limit and shows the too-large copy', async () => {
    setLocals(paying);
    const fetchMock = stubServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [
      fileOfSize('archive.zip', UPLOAD_FILE_PAYING_MAX_BYTES + 1),
    ]);

    expect(
      await screen.findByText(/This file is too large to convert in one go\./)
    ).toBeInTheDocument();
    await settle();
    expect(uploadsSent(fetchMock)).toEqual([]);
  });
});

describe('UploadForm reads the account again before refusing a file over the free limit', () => {
  const MEGABYTE = 1024 * 1024;
  const fileOver = () => fileOfSize('lecture.pdf', 150 * MEGABYTE);

  function returnFromPassCheckout() {
    vi.stubGlobal('location', {
      search: '?from=pass&session_id=cs_test_paid',
      href: 'http://localhost/upload?from=pass&session_id=cs_test_paid',
      origin: 'http://localhost',
      pathname: '/upload',
    });
  }

  it.each([
    ['', () => {}],
    [' back from a pass checkout', returnFromPassCheckout],
  ])(
    'sends the file when the fresh read says paying%s',
    async (_where, arrange) => {
      arrange();
      const refetch = setLocals(signedInFree, {
        refetch: vi.fn().mockResolvedValue(freshRead(paying)),
      });
      const fetchMock = stubServer();
      const { container } = renderForm();

      await pickAndSubmit(container, [fileOver()]);

      await waitFor(() => expect(uploadsSent(fetchMock)).toHaveLength(1));
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(OVER_FREE_TITLE)).toBeNull();
    }
  );

  it('sends the file back from a pass checkout while the fresh read still says free', async () => {
    returnFromPassCheckout();
    setLocals(signedInFree);
    const fetchMock = stubServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [fileOver()]);

    await waitFor(() => expect(uploadsSent(fetchMock)).toHaveLength(1));
    expect(screen.queryByText(OVER_FREE_TITLE)).toBeNull();
  });

  it('sends the file when the fresh read fails', async () => {
    setLocals(signedInFree, {
      refetch: vi.fn().mockResolvedValue({ status: 'error', data: undefined }),
    });
    const fetchMock = stubServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [fileOver()]);

    await waitFor(() => expect(uploadsSent(fetchMock)).toHaveLength(1));
  });

  it('sends the file when a pass token was stored while the account was read', async () => {
    setLocals(signedInFree, {
      refetch: vi.fn(async () => {
        storePassToken('cs_bought_meanwhile');
        return freshRead(signedInFree);
      }),
    });
    const fetchMock = stubServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [fileOver()]);

    await waitFor(() => expect(uploadsSent(fetchMock)).toHaveLength(1));
  });

  it('shows the upload in progress while the account is read', async () => {
    setLocals(signedInFree, {
      refetch: vi.fn(() => new Promise(() => {})),
    });
    stubServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [fileOver()]);

    expect(container.querySelector('[class*="progressTrack"]')).not.toBeNull();
    expect(screen.queryByText(OVER_FREE_TITLE)).toBeNull();
  });

  describe('when the read does not answer in time', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends the file once the read cap passes', async () => {
      setLocals(signedInFree, {
        refetch: vi.fn(() => new Promise(() => {})),
      });
      const fetchMock = stubServer();
      const { container } = renderForm();

      await pickAndSubmit(container, [fileOver()]);
      expect(uploadsSent(fetchMock)).toEqual([]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(uploadsSent(fetchMock)).toHaveLength(1);
    });

    it('does not send the file again or show the wall when the account answers after the cap', async () => {
      const read = controlledRead();
      setLocals(signedInFree, { refetch: read.refetch });
      const fetchMock = stubServer();
      const { container } = renderForm();

      await pickAndSubmit(container, [fileOver()]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await act(async () => {
        read.answer(freshRead(signedInFree));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(uploadsSent(fetchMock)).toHaveLength(1);
      expect(screen.queryByText(OVER_FREE_TITLE)).toBeNull();
    });
  });

  it('sends the file back from a subscription checkout while the fresh read still says free', async () => {
    vi.stubGlobal('location', {
      search: '?checkout=success',
      href: 'http://localhost/upload?checkout=success',
      origin: 'http://localhost',
      pathname: '/upload',
    });
    setLocals(signedInFree);
    const fetchMock = stubServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [fileOver()]);

    await waitFor(() => expect(uploadsSent(fetchMock)).toHaveLength(1));
    expect(screen.queryByText(OVER_FREE_TITLE)).toBeNull();
  });

  describe('when something happens while the account is read', () => {
    const progressBar = (container: HTMLElement) =>
      container.querySelector('[class*="progressTrack"]');

    it.each([
      ['a file it would take', () => fileOfSize('notes.pdf', 1024)],
      ['a file its checks turn away', () => fileOfSize('shortcut.lnk', 1024)],
    ])(
      'ignores a second drop of %s and shows the wall for the first file',
      async (_kind, secondFile) => {
        const read = controlledRead();
        setLocals(signedInFree, { refetch: read.refetch });
        const fetchMock = stubServer();
        const { container } = renderForm();

        await drop(container, [fileOver()]);
        await waitFor(() => expect(read.refetch).toHaveBeenCalledTimes(1));
        await drop(container, [secondFile()]);
        await act(async () => {
          read.answer(freshRead(signedInFree));
        });

        expect(await screen.findByText(OVER_FREE_TITLE)).toBeInTheDocument();
        expect(screen.getByText(/lecture\.pdf/)).toBeInTheDocument();
        expect(progressBar(container)).toBeNull();
        await settle();
        expect(uploadsSent(fetchMock)).toEqual([]);
        expect(read.refetch).toHaveBeenCalledTimes(1);
      }
    );

    it('sends only the first file when a second drop comes in and the read says paying', async () => {
      const read = controlledRead();
      setLocals(signedInFree, { refetch: read.refetch });
      const fetchMock = stubServer();
      const { container } = renderForm();

      await drop(container, [fileOver()]);
      await waitFor(() => expect(read.refetch).toHaveBeenCalledTimes(1));
      await drop(container, [fileOfSize('notes.pdf', 1024)]);
      await act(async () => {
        read.answer(freshRead(paying));
      });

      await waitFor(() => expect(uploadsSent(fetchMock)).toHaveLength(1));
      expect(vi.mocked(track)).toHaveBeenCalledWith(
        'upload_submitted',
        expect.objectContaining({ input_format: 'pdf' })
      );
    });

    it('drops the first file and sends a folder dropped during the read, with no wall', async () => {
      const read = controlledRead();
      setLocals(signedInFree, { refetch: read.refetch });
      const fetchMock = stubServer();
      const { container } = renderForm();

      class FakeDataTransfer {
        files: File[] = [];
        items = { add: (file: File) => this.files.push(file) };
      }
      vi.stubGlobal('DataTransfer', FakeDataTransfer);
      await drop(container, [fileOver()]);
      await waitFor(() => expect(read.refetch).toHaveBeenCalledTimes(1));
      const page = {
        isFile: true,
        isDirectory: false,
        name: 'notes.html',
        fullPath: '/notes/notes.html',
        file: (resolve: (file: File) => void) =>
          resolve(new File(['<p>Krebs</p>'], 'notes.html')),
      };
      const folder = {
        isFile: false,
        isDirectory: true,
        name: 'notes',
        fullPath: '/notes',
        createReader: () => {
          const batches: unknown[][] = [[page], []];
          return {
            readEntries: (resolve: (batch: unknown[]) => void) =>
              resolve(batches.shift() ?? []),
          };
        },
      };
      const folderDrop = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(folderDrop, 'dataTransfer', {
        value: { items: [{ webkitGetAsEntry: () => folder }], files: [] },
      });
      await act(async () => {
        document.body.dispatchEvent(folderDrop);
      });
      await act(async () => {
        read.answer(freshRead(signedInFree));
      });

      await waitFor(() => expect(uploadsSent(fetchMock)).toHaveLength(1));
      const submitted = vi
        .mocked(track)
        .mock.calls.filter(([name]) => name === 'upload_submitted');
      expect(submitted).toEqual([
        ['upload_submitted', expect.objectContaining({ input_format: 'zip' })],
      ]);
      expect(screen.queryByText(OVER_FREE_TITLE)).toBeNull();
    });

    it('sends nothing and logs no error when the page goes away during the read', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const read = controlledRead();
      setLocals(signedInFree, { refetch: read.refetch });
      const fetchMock = stubServer();
      const { container, unmount } = renderForm();

      await pickAndSubmit(container, [fileOver()]);
      unmount();
      await act(async () => {
        read.answer(freshRead(paying));
      });
      await settle();

      expect(uploadsSent(fetchMock)).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });
});

describe('UploadForm unlock of a locked PDF', () => {
  function stubLockedPdfServer(): Mock {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/upload/file') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: 'needs_password',
              reason: 'missing_password',
            }),
            { status: 400, headers: { 'X-Upload-Owner': '7' } }
          )
        );
      }
      if (url === '/api/upload/retry-with-credential') {
        return Promise.resolve(deckResponse());
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  async function unlock() {
    fireEvent.change(await screen.findByLabelText('PDF password'), {
      target: { value: 'open-sesame' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    });
  }

  const unlocksSent = (fetchMock: Mock) =>
    fetchMock.mock.calls.filter(
      ([url]) => url === '/api/upload/retry-with-credential'
    );

  it('does not send a locked PDF over the unlock limit with its password', async () => {
    setLocals(paying);
    const fetchMock = stubLockedPdfServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [
      fileOfSize('locked.pdf', PDF_UNLOCK_MAX_BYTES + 1),
    ]);
    await unlock();

    expect(
      await screen.findByText(/This file is too large to convert in one go\./)
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('PDF password')).toBeNull();
    await settle();
    expect(unlocksSent(fetchMock)).toEqual([]);
  });

  it('sends a locked PDF exactly at the unlock limit with its password', async () => {
    setLocals(paying);
    const fetchMock = stubLockedPdfServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [
      fileOfSize('locked.pdf', PDF_UNLOCK_MAX_BYTES),
    ]);
    await unlock();

    await waitFor(() => expect(unlocksSent(fetchMock)).toHaveLength(1));
  });
});

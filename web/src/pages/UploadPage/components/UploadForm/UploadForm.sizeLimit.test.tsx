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

function setLocals(
  data: Locals,
  state: { isLoading?: boolean; isError?: boolean } = {}
) {
  vi.mocked(useUserLocals).mockReturnValue({
    data,
    isLoading: state.isLoading ?? false,
    error: null,
    isError: state.isError ?? false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useUserLocals>);
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
  it('does not send a file one byte over the free limit and shows the file size limit', async () => {
    setLocals(signedInFree);
    const fetchMock = stubServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [
      fileOfSize('lecture.pdf', UPLOAD_FILE_FREE_MAX_BYTES + 1),
    ]);

    expect(await screen.findByText(OVER_FREE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(/lecture\.pdf/)).toBeInTheDocument();
    await settle();
    expect(uploadsSent(fetchMock)).toEqual([]);
  });

  it('sends a file exactly at the free limit', async () => {
    setLocals(signedInFree);
    const fetchMock = stubServer();
    const { container } = renderForm();

    await pickAndSubmit(container, [
      fileOfSize('lecture.pdf', UPLOAD_FILE_FREE_MAX_BYTES),
    ]);

    await waitFor(() => expect(uploadsSent(fetchMock)).toHaveLength(1));
    expect(screen.queryByText(OVER_FREE_TITLE)).toBeNull();
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

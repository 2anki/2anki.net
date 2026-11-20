import { act, render, screen, waitFor } from '@testing-library/react';
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
import { clearPassToken } from '../../../../lib/anonymousPass';
import { resetPendingUploadStoreForTests } from '../../../../lib/upload/pendingUpload';
import { resetLastDeckStoreForTests } from '../../../../lib/upload/lastDeck';

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

const signedInFree = {
  user: { id: 1 },
  locals: { owner: 1, patreon: false, subscriber: false },
  features: {},
} as unknown as ReturnType<typeof useUserLocals>['data'];

function deckResponse(cardCount: number) {
  return {
    redirected: false,
    status: 200,
    headers: new Headers({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="deck.apkg"',
      'X-Card-Count': String(cardCount),
    }),
    blob: () => Promise.resolve(new Blob(['fake'])),
  };
}

function holdUploads() {
  const answers: Array<(response: unknown) => void> = [];
  const fetchMock = vi.fn((url: string) =>
    url === '/api/upload/file'
      ? new Promise((resolve) => answers.push(resolve))
      : Promise.resolve(new Response(null, { status: 204 }))
  );
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    answer: (index: number, response: unknown) => answers[index](response),
  };
}

const uploadsSent = (fetchMock: Mock) =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/upload/file');

const submittedFormats = () =>
  vi
    .mocked(track)
    .mock.calls.filter(([name]) => name === 'upload_submitted')
    .map(([, props]) => (props as { input_format?: string }).input_format);

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <UploadForm setErrorMessage={vi.fn()} aiOn={false} />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const input = view.container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    value: null,
    writable: true,
    configurable: true,
  });
  input.removeAttribute('required');
  return view;
}

async function dropOnPage(dataTransfer: { items: unknown[]; files: File[] }) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  await act(async () => {
    document.body.dispatchEvent(event);
  });
  return event;
}

const dropFile = (name: string) =>
  dropOnPage({ items: [], files: [new File(['x'], name)] });

function notesFolder() {
  let handOver: () => void = () => {};
  const page = {
    isFile: true,
    isDirectory: false,
    name: 'notes.html',
    fullPath: '/notes/notes.html',
    file: (resolve: (file: File) => void) => {
      handOver = () => resolve(new File(['<p>Krebs</p>'], 'notes.html'));
    },
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
  return {
    drop: () =>
      dropOnPage({ items: [{ webkitGetAsEntry: () => folder }], files: [] }),
    release: async () => {
      await act(async () => {
        handOver();
      });
    },
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

const liveRegion = (container: HTMLElement) =>
  container.querySelector('output[aria-live="polite"]')?.textContent;

const PACKING = 'Packing your folder into a zip.';

class FakeDataTransfer {
  files: File[] = [];
  items = { add: (file: File) => this.files.push(file) };
}

beforeEach(() => {
  resetPendingUploadStoreForTests();
  resetLastDeckStoreForTests();
  vi.mocked(track).mockClear();
  globalThis.localStorage.clear();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:deck');
  vi.stubGlobal('DataTransfer', FakeDataTransfer);
  vi.mocked(useUserLocals).mockReturnValue({
    data: signedInFree,
    isLoading: false,
    error: null,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useUserLocals>);
});

afterEach(() => {
  clearPassToken();
  vi.unstubAllGlobals();
});

describe('UploadForm ignores a drop while an upload is under way', () => {
  it('ignores a folder dropped during an upload and shows the deck from the first file', async () => {
    const server = holdUploads();
    const { container } = renderForm();

    await dropFile('lecture.pdf');
    await waitFor(() => expect(uploadsSent(server.fetchMock)).toHaveLength(1));
    const folder = notesFolder();
    const folderDrop = await folder.drop();
    await folder.release();
    await settle();

    expect(folderDrop.defaultPrevented).toBe(true);
    expect(screen.queryByText(PACKING, { selector: 'p' })).toBeNull();
    expect(vi.mocked(track)).not.toHaveBeenCalledWith('folder_upload_packaged');

    await act(async () => {
      server.answer(0, deckResponse(5));
    });

    await waitFor(() =>
      expect(liveRegion(container)).toBe('Your deck is ready — 5 cards.')
    );
    await settle();
    expect(uploadsSent(server.fetchMock)).toHaveLength(1);
    expect(submittedFormats()).toEqual(['pdf']);
  });

  it.each([
    ['a file', () => dropFile('lecture.pdf')],
    ['another folder', () => notesFolder().drop()],
  ])(
    'ignores %s dropped while a folder is packed, and sends only the folder',
    async (_what, secondDrop) => {
      const server = holdUploads();
      const { container } = renderForm();

      const folder = notesFolder();
      await folder.drop();
      expect(screen.getByText(PACKING, { selector: 'p' })).toBeInTheDocument();
      const ignored = await secondDrop();
      await folder.release();

      await waitFor(() =>
        expect(uploadsSent(server.fetchMock)).toHaveLength(1)
      );
      await act(async () => {
        server.answer(0, deckResponse(3));
      });
      await waitFor(() =>
        expect(liveRegion(container)).toBe('Your deck is ready — 3 cards.')
      );
      await settle();

      expect(ignored.defaultPrevented).toBe(true);
      expect(uploadsSent(server.fetchMock)).toHaveLength(1);
      expect(submittedFormats()).toEqual(['zip']);
    }
  );

  it('packs and sends a folder dropped on an idle form', async () => {
    const server = holdUploads();
    const { container } = renderForm();

    const folder = notesFolder();
    await folder.drop();
    await folder.release();

    await waitFor(() => expect(uploadsSent(server.fetchMock)).toHaveLength(1));
    await act(async () => {
      server.answer(0, deckResponse(2));
    });

    await waitFor(() =>
      expect(liveRegion(container)).toBe('Your deck is ready — 2 cards.')
    );
    expect(vi.mocked(track)).toHaveBeenCalledWith('folder_upload_packaged');
    expect(submittedFormats()).toEqual(['zip']);
  });
});

import { fireEvent, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import UploadForm from './UploadForm';
import { resetPendingUploadStoreForTests } from '../../../../lib/upload/pendingUpload';
import { resetLastDeckStoreForTests } from '../../../../lib/upload/lastDeck';
import { resetLastDeckMoveForTests } from '../../../../lib/backend/getUserLocals';
import { giftHandoffState } from '../../../../lib/aiGift/giftHandoff';

vi.mock('../../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

vi.mock('../../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: vi.fn(() => ({
    baseURL: '/api/',
    startPassCheckout: vi.fn().mockResolvedValue({ status: 'error' }),
    getUploads: vi.fn().mockResolvedValue([]),
    getHeldDeck: vi.fn().mockResolvedValue(null),
    getCheckoutPrices: vi.fn().mockResolvedValue(null),
    claimRecoveryDeck: vi.fn().mockResolvedValue(404),
  })),
}));

vi.mock('../../../../lib/reportClientError', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../../lib/reportClientError')
  >()),
  reportClientError: vi.fn(),
}));

vi.mock('../../../../lib/hooks/usePassPrices', () => ({
  usePassPrices: () => ({ '24h': '$6', '7d': '$12', '120d': '$29' }),
}));

vi.mock('./dropWaitPlan', () => ({
  dropWaitDelays: vi.fn(() => []),
}));

const session = {
  locals: {
    owner: 7,
    patreon: false,
    subscriber: false,
    subscriptionInfo: { active: false, email: '', linked_email: '' },
  },
  linked_email: '',
  user: { id: 7, patreon: false },
  features: {},
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const sent: FormData[] = [];

function renderForm(
  options: {
    holdChosenFiles?: (files: File[]) => boolean;
    state?: unknown;
  } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: '/upload', state: options.state ?? null }]}
    >
      <QueryClientProvider client={queryClient}>
        <UploadForm
          setErrorMessage={vi.fn()}
          holdChosenFiles={options.holdChosenFiles}
        />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  resetPendingUploadStoreForTests();
  resetLastDeckStoreForTests();
  resetLastDeckMoveForTests();
  sent.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('users/debug/locals')) {
        return Promise.resolve(jsonResponse(session));
      }
      if (url === '/api/users/usage') {
        return Promise.resolve(
          jsonResponse({ cards_used: 0, cards_limit: 100, unlimited: false })
        );
      }
      if (url === '/api/upload/file') {
        sent.push(init?.body as FormData);
        return Promise.resolve(jsonResponse({ message: 'stop' }, 400));
      }
      return Promise.resolve(jsonResponse(null));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function chooseFile(container: HTMLElement, name: string) {
  const input = container.querySelector('#pakker') as HTMLInputElement;
  const file = new File(['Some notes about cells'], name, {
    type: 'text/plain',
  });
  Object.defineProperty(input, 'files', {
    value: [file],
    configurable: true,
  });
  input.removeAttribute('required');
  fireEvent.change(input);
  return file;
}

describe('UploadForm and the upload card', () => {
  it('hands a chosen file to the upload card instead of sending it, when the card takes it', async () => {
    const hold = vi.fn(() => true);
    const { container } = renderForm({ holdChosenFiles: hold });

    const file = chooseFile(container, 'notes.txt');

    await waitFor(() => expect(hold).toHaveBeenCalledWith([file]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent).toEqual([]);
  });

  it('sends a chosen file as before when the card leaves it', async () => {
    const hold = vi.fn(() => false);
    const { container } = renderForm({ holdChosenFiles: hold });

    chooseFile(container, 'notes.txt');

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(hold).toHaveBeenCalledTimes(1);
  });

  it('sends a chosen file as before with no upload card', async () => {
    const { container } = renderForm();

    chooseFile(container, 'notes.txt');

    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it.each([
    [true, 'true'],
    [false, 'false'],
  ])(
    'converts files from the convert step with Claude %s, as the request’s own choice',
    async (claude, flag) => {
      const file = new File(['# Notes'], 'notes.md', { type: 'text/markdown' });

      renderForm({ state: giftHandoffState({ files: [file], claude }) });

      await waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0].get('claude-ai-flashcards')).toBe(flag);
      expect(sent[0].get('ai-gift-switch')).toBe('true');
      expect(sent[0].get('ai-choice-at')).toMatch(/^\d+$/);
      expect((sent[0].get('pakker') as File).name).toBe('notes.md');
    }
  );

  it('converts a photo handed over with no Claude choice without setting one', async () => {
    const photo = new File(['x'], 'board.jpg', { type: 'image/jpeg' });

    renderForm({ state: giftHandoffState({ files: [photo], claude: null }) });

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].get('ai-choice-at')).toBeNull();
    expect(sent[0].get('ai-gift-switch')).toBeNull();
  });
});

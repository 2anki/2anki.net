import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import UploadForm from './UploadForm';
import { CARD_USAGE_QUERY_KEY } from '../../../../lib/hooks/useCardUsage';
import {
  readUploadZoneActivity,
  subscribeUploadZoneActivity,
  type UploadZoneActivity,
} from '../../../../lib/upload/uploadZoneActivity';
import { resetPendingUploadStoreForTests } from '../../../../lib/upload/pendingUpload';
import { resetLastDeckStoreForTests } from '../../../../lib/upload/lastDeck';
import { resetLastDeckMoveForTests } from '../../../../lib/backend/getUserLocals';

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

const freeLocals = {
  owner: 0,
  patreon: false,
  subscriber: false,
  subscriptionInfo: { active: false, email: '', linked_email: '' },
};

const signedOut = { locals: freeLocals, linked_email: '', features: {} };

function signedInAs(id: number) {
  return {
    locals: { ...freeLocals, owner: id },
    linked_email: '',
    user: { id, patreon: false },
    features: {},
  };
}

const atLimit = { cards_used: 100, cards_limit: 100, unlimited: false };
const underLimit = { cards_used: 10, cards_limit: 100, unlimited: false };
const limitWallTitle = "You've used all 100 cards this month";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

let session: unknown = signedOut;
let pendingUsage: Array<(body: unknown) => void> = [];
let reported: UploadZoneActivity[] = [];
let stopListening: () => void = () => {};

function answerUsage(body: unknown) {
  const next = pendingUsage.shift();
  if (next == null) throw new Error('no counts request is waiting');
  next(body);
}

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <UploadForm setErrorMessage={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>
  );
  return queryClient;
}

async function refetchSession(queryClient: QueryClient, next: unknown) {
  session = next;
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ['userLocals'] });
  });
  await flushQueryNotifications();
}

async function flushQueryNotifications() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  resetPendingUploadStoreForTests();
  resetLastDeckStoreForTests();
  resetLastDeckMoveForTests();
  session = signedOut;
  pendingUsage = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('users/debug/locals')) {
        return Promise.resolve(jsonResponse(session));
      }
      if (url === '/api/users/usage') {
        return new Promise((resolve) =>
          pendingUsage.push((body) => resolve(jsonResponse(body)))
        );
      }
      return Promise.resolve(jsonResponse(null));
    })
  );
});

afterEach(() => {
  stopListening();
  vi.unstubAllGlobals();
});

function listen() {
  reported = [];
  stopListening = subscribeUploadZoneActivity(() => {
    reported.push(readUploadZoneActivity());
  });
}

describe('UploadForm zone activity with the real session and counts', () => {
  it('reports idle for a signed-out visitor once the session arrives', async () => {
    const queryClient = renderForm();

    await waitFor(() => expect(readUploadZoneActivity()).toBe('idle'));
    expect(queryClient.getQueryData(['userLocals'])).toEqual(signedOut);
    expect(pendingUsage).toHaveLength(0);
  });

  it('ends idle without asking for counts when the session read fails', async () => {
    session = { message: 'down' };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('users/debug/locals')) {
        return Promise.resolve(
          new Response(JSON.stringify(session), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(jsonResponse(null));
    });
    const queryClient = renderForm();
    expect(readUploadZoneActivity()).toBe('busy');

    await waitFor(
      () =>
        expect(queryClient.getQueryState(['userLocals'])?.status).toBe('error'),
      { timeout: 6000 }
    );

    await waitFor(() => expect(readUploadZoneActivity()).toBe('idle'));
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/users/usage')
    ).toHaveLength(0);
  }, 10000);

  it('waits once for the counts when a visitor signs in mid-page', async () => {
    const queryClient = renderForm();
    await waitFor(() => expect(readUploadZoneActivity()).toBe('idle'));

    listen();
    await refetchSession(queryClient, signedInAs(1));
    expect(readUploadZoneActivity()).toBe('busy');
    expect(pendingUsage).toHaveLength(1);

    await act(async () => answerUsage(underLimit));
    await waitFor(() => expect(readUploadZoneActivity()).toBe('idle'));

    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: CARD_USAGE_QUERY_KEY });
    });
    await flushQueryNotifications();
    expect(pendingUsage).toHaveLength(1);
    expect(readUploadZoneActivity()).toBe('idle');
    expect(reported).toEqual(['busy', 'idle']);
  });

  it('stays idle when a signed-in account signs out mid-page', async () => {
    session = signedInAs(1);
    const queryClient = renderForm();
    await waitFor(() => expect(pendingUsage).toHaveLength(1));
    await act(async () => answerUsage(underLimit));
    await waitFor(() => expect(readUploadZoneActivity()).toBe('idle'));

    listen();
    await refetchSession(queryClient, signedOut);

    expect(queryClient.getQueryData(['userLocals'])).toEqual(signedOut);
    expect(reported).toEqual([]);
    expect(readUploadZoneActivity()).toBe('idle');
  });

  it('fetches the new account counts on a swap and never shows the last account its wall', async () => {
    session = signedInAs(1);
    const queryClient = renderForm();
    await waitFor(() => expect(pendingUsage).toHaveLength(1));
    await act(async () => answerUsage(atLimit));
    expect(await screen.findByText(limitWallTitle)).toBeInTheDocument();
    expect(readUploadZoneActivity()).toBe('busy');

    listen();
    await refetchSession(queryClient, signedInAs(2));

    expect(screen.queryByText(limitWallTitle)).not.toBeInTheDocument();
    expect(pendingUsage).toHaveLength(1);
    expect(readUploadZoneActivity()).toBe('busy');

    await act(async () => answerUsage(underLimit));
    await waitFor(() => expect(readUploadZoneActivity()).toBe('idle'));
    expect(screen.queryByText(limitWallTitle)).not.toBeInTheDocument();
    expect(reported).toEqual(['idle']);
  });
});

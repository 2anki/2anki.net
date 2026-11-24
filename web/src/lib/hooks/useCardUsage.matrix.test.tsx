import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

import { CARD_USAGE_QUERY_KEY, useCardUsage } from './useCardUsage';
import { useUserLocals } from './useUserLocals';
import { isPayingUser } from '../../components/NavigationBar/helpers/getPlanLabel';
import { resetLastDeckMoveForTests } from '../backend/getUserLocals';
import { resetLastDeckStoreForTests } from '../upload/lastDeck';

vi.mock('../backend/get2ankiApi', () => ({
  get2ankiApi: vi.fn(() => ({
    baseURL: '/api/',
    claimRecoveryDeck: vi.fn().mockResolvedValue(404),
  })),
}));

const LOCALS_URL = '/api/users/debug/locals';
const USAGE_URL = '/api/users/usage';
const ACCOUNT_A = 7;
const ACCOUNT_B = 8;
const CARDS_USED_BY: Record<number, number> = {
  [ACCOUNT_A]: 42,
  [ACCOUNT_B]: 9,
};

const freeLocals = {
  owner: 0,
  patreon: false,
  subscriber: false,
  subscriptionInfo: { active: false, email: '', linked_email: '' },
};

type Session = {
  locals: typeof freeLocals;
  linked_email: string;
  user?: { id: number; patreon: boolean };
};

const signedOut: Session = { locals: freeLocals, linked_email: '' };

function signedInAs(id: number): Session {
  return {
    locals: { ...freeLocals, owner: id },
    linked_email: '',
    user: { id, patreon: false },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let currentSession: Session | 'failed' = signedOut;
let holdSession = false;
let releaseHeld: Array<() => void> = [];
let fetchMock: ReturnType<typeof vi.fn>;

function sessionResponse(): Response {
  if (currentSession === 'failed') return json({ message: 'down' }, 500);
  return json(currentSession);
}

function usageResponse(): Response {
  const id = currentSession === 'failed' ? undefined : currentSession.user?.id;
  if (id == null) return json({ message: 'Authentication required' }, 401);
  return json({
    cards_used: CARDS_USED_BY[id],
    cards_limit: 100,
    unlimited: false,
  });
}

const usageRequests = () =>
  fetchMock.mock.calls.filter(([url]) => url === USAGE_URL).length;

beforeEach(() => {
  resetLastDeckStoreForTests();
  resetLastDeckMoveForTests();
  currentSession = signedOut;
  holdSession = false;
  releaseHeld = [];
  fetchMock = vi.fn((url: string) => {
    if (url === LOCALS_URL) {
      if (holdSession) {
        return new Promise<Response>((resolve) =>
          releaseHeld.push(() => resolve(sessionResponse()))
        );
      }
      return Promise.resolve(sessionResponse());
    }
    if (url === USAGE_URL) return Promise.resolve(usageResponse());
    return Promise.resolve(json(null));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type SessionData = Session | undefined;

const callShapes = {
  pricing: () => true,
  'upload form and search': (session: SessionData) => session?.user?.id != null,
  'account menu': (session: SessionData) =>
    session?.locals != null && !isPayingUser(session.locals),
};
type CallShape = keyof typeof callShapes;

type Reading = {
  sessionUserId: number | null;
  cardsUsed: number | null;
};

function mount(shape: CallShape, queryClient: QueryClient) {
  const readings: Reading[] = [];
  const view = renderHook(
    () => {
      const session = useUserLocals().data as SessionData;
      const value = useCardUsage(callShapes[shape](session));
      readings.push({
        sessionUserId: session?.user?.id ?? null,
        cardsUsed: value?.cards_used ?? null,
      });
      return value;
    },
    {
      wrapper: ({ children }: { children: React.ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    }
  );
  return { ...view, readings };
}

async function switchSession(queryClient: QueryClient, next: Session) {
  currentSession = next;
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ['userLocals'] });
  });
}

const counts = (cardsUsed: number) => ({
  cards_used: cardsUsed,
  cards_limit: 100,
  unlimited: false,
  loading: false,
});

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('useCardUsage across every caller and session state', () => {
  it.each([
    ['pricing', counts(0), 1],
    ['upload form and search', null, 0],
  ] as const)(
    'signed-out visitor, %s call: returns the expected counts and request count',
    async (shape, expected, requests) => {
      const { result } = mount(shape, newClient());

      await waitFor(() => expect(result.current).toEqual(expected));
      await waitFor(() => expect(usageRequests()).toBe(requests));
    }
  );

  it.each([
    ['pricing', 42],
    ['upload form and search', 42],
    ['account menu', 42],
  ] as const)(
    'session already cached, %s call: one request under the account',
    async (shape, cardsUsed) => {
      currentSession = signedInAs(ACCOUNT_A);
      const queryClient = newClient();
      queryClient.setQueryData(['userLocals'], signedInAs(ACCOUNT_A));

      const { result } = mount(shape, queryClient);

      await waitFor(() => expect(result.current).toEqual(counts(cardsUsed)));
      expect(usageRequests()).toBe(1);
      expect(
        queryClient.getQueryData([...CARD_USAGE_QUERY_KEY, null])
      ).toBeUndefined();
    }
  );

  it.each([
    ['pricing', { ...counts(0), loading: true }],
    ['upload form and search', null],
  ] as const)(
    'cold mount, %s call: waits for the session, then one request under the account',
    async (shape, whileLoading) => {
      holdSession = true;
      currentSession = signedInAs(ACCOUNT_A);
      const queryClient = newClient();

      const { result } = mount(shape, queryClient);
      expect(result.current).toEqual(whileLoading);

      await act(async () => {
        for (const release of releaseHeld.splice(0)) release();
      });
      await waitFor(() => expect(result.current).toEqual(counts(42)));
      expect(usageRequests()).toBe(1);
      expect(
        queryClient.getQueryData([...CARD_USAGE_QUERY_KEY, null])
      ).toBeUndefined();
    }
  );

  it.each(['pricing', 'upload form and search'] as const)(
    'session read failed, %s call: returns nothing and makes no counts request',
    async (shape) => {
      currentSession = 'failed';
      const queryClient = newClient();

      const { result } = mount(shape, queryClient);

      await waitFor(
        () =>
          expect(queryClient.getQueryState(['userLocals'])?.status).toBe(
            'error'
          ),
        { timeout: 6000 }
      );
      await waitFor(() => expect(result.current).toBeNull());
      expect(usageRequests()).toBe(0);
    },
    10000
  );

  it.each(['pricing', 'upload form and search', 'account menu'] as const)(
    'account swap A to B, %s call: fetches B and never returns A counts to B',
    async (shape) => {
      currentSession = signedInAs(ACCOUNT_A);
      const queryClient = newClient();
      const { result, readings } = mount(shape, queryClient);
      await waitFor(() => expect(result.current).toEqual(counts(42)));

      await switchSession(queryClient, signedInAs(ACCOUNT_B));

      await waitFor(() => expect(result.current).toEqual(counts(9)));
      expect(usageRequests()).toBe(2);
      expect(
        readings.filter(
          (reading) =>
            reading.sessionUserId === ACCOUNT_B && reading.cardsUsed === 42
        )
      ).toEqual([]);
    }
  );

  it.each([
    ['pricing', counts(0), 2],
    ['upload form and search', null, 1],
  ] as const)(
    'sign-out, %s call: never shows the old account counts',
    async (shape, expected, requests) => {
      currentSession = signedInAs(ACCOUNT_A);
      const queryClient = newClient();
      const { result, readings } = mount(shape, queryClient);
      await waitFor(() => expect(result.current).toEqual(counts(42)));

      await switchSession(queryClient, signedOut);

      await waitFor(() => expect(result.current).toEqual(expected));
      await waitFor(() => expect(usageRequests()).toBe(requests));
      expect(
        readings.filter(
          (reading) => reading.sessionUserId == null && reading.cardsUsed === 42
        )
      ).toEqual([]);
    }
  );
});

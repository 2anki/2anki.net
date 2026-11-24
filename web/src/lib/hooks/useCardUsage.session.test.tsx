import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

import { CARD_USAGE_QUERY_KEY, useCardUsage } from './useCardUsage';
import { useUserLocals } from './useUserLocals';
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

const freeLocals = {
  owner: 0,
  patreon: false,
  subscriber: false,
  subscriptionInfo: { active: false, email: '', linked_email: '' },
};
const signedOut = { locals: freeLocals, linked_email: '' };

function signedInAs(id: number) {
  return {
    locals: { ...freeLocals, owner: id },
    linked_email: '',
    user: { id, patreon: false },
  };
}

function usage(cardsUsed: number) {
  return { cards_used: cardsUsed, cards_limit: 100, unlimited: false };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Answer = () => Response;

let sessionAnswer: Answer;
let usageAnswer: Answer;
let pendingSession: Array<() => void> = [];
let holdSession = false;
let fetchMock: ReturnType<typeof vi.fn>;

const usageRequests = () =>
  fetchMock.mock.calls.filter(([url]) => url === USAGE_URL).length;

function releaseSession() {
  for (const release of pendingSession.splice(0)) release();
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const cachedUnder = (queryClient: QueryClient, userId: number | null) =>
  queryClient.getQueryData([...CARD_USAGE_QUERY_KEY, userId]);

beforeEach(() => {
  resetLastDeckStoreForTests();
  resetLastDeckMoveForTests();
  pendingSession = [];
  holdSession = false;
  sessionAnswer = () => json(signedOut);
  usageAnswer = () => json({ message: 'Authentication required' }, 401);
  fetchMock = vi.fn((url: string) => {
    if (url === LOCALS_URL) {
      if (holdSession) {
        return new Promise<Response>((resolve) =>
          pendingSession.push(() => resolve(sessionAnswer()))
        );
      }
      return Promise.resolve(sessionAnswer());
    }
    if (url === USAGE_URL) return Promise.resolve(usageAnswer());
    return Promise.resolve(json(null));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCardUsage with the real session', () => {
  it('waits for the session on a cold signed-in mount, then fetches once under the account', async () => {
    holdSession = true;
    sessionAnswer = () => json(signedInAs(7));
    usageAnswer = () => json(usage(42));
    const queryClient = newClient();
    const seen: Array<boolean | undefined> = [];

    const { result } = renderHook(
      () => {
        const value = useCardUsage(true);
        seen.push(value?.loading);
        return value;
      },
      { wrapper: wrapperFor(queryClient) }
    );

    expect(result.current?.loading).toBe(true);
    await act(async () => releaseSession());
    await waitFor(() => expect(result.current?.cards_used).toBe(42));

    expect(usageRequests()).toBe(1);
    expect(cachedUnder(queryClient, 7)).toEqual(usage(42));
    expect(cachedUnder(queryClient, null)).toBeUndefined();
    expect(seen.lastIndexOf(true)).toBeLessThan(seen.indexOf(false));
  });

  it('still asks for counts once for a signed-out visitor, as the pricing page always has', async () => {
    const queryClient = newClient();

    const { result } = renderHook(() => useCardUsage(true), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(usageRequests()).toBe(1);
    expect(result.current).toEqual({ ...usage(0), loading: false });
  });

  it('reports no counts and asks for none when the session read fails', async () => {
    sessionAnswer = () => json({ message: 'down' }, 500);
    const queryClient = newClient();

    const { result } = renderHook(() => useCardUsage(true), {
      wrapper: wrapperFor(queryClient),
    });

    expect(result.current?.loading).toBe(true);
    await waitFor(() => expect(result.current).toBeNull(), {
      timeout: 6000,
    });
    expect(usageRequests()).toBe(0);
    expect(cachedUnder(queryClient, null)).toBeUndefined();
  }, 10000);

  it('never shows the previous account its counts after signing out', async () => {
    sessionAnswer = () => json(signedInAs(7));
    usageAnswer = () => json(usage(42));
    const queryClient = newClient();
    const usedAfterSignOut: Array<number | undefined> = [];
    let signedOutNow = false;

    const { result } = renderHook(
      () => {
        const session = useUserLocals().data;
        const value = useCardUsage(true);
        if (signedOutNow && session?.user == null) {
          usedAfterSignOut.push(value?.cards_used);
        }
        return value;
      },
      { wrapper: wrapperFor(queryClient) }
    );
    await waitFor(() => expect(result.current?.cards_used).toBe(42));

    sessionAnswer = () => json(signedOut);
    usageAnswer = () => json({ message: 'Authentication required' }, 401);
    signedOutNow = true;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['userLocals'] });
    });
    await waitFor(() => expect(usageRequests()).toBe(2));
    await waitFor(() => expect(result.current?.loading).toBe(false));

    expect(usedAfterSignOut).not.toContain(42);
    expect(result.current?.cards_used).toBe(0);
  });

  it('returns nothing after signing out when the caller turns counts off, as search and the upload form do', async () => {
    sessionAnswer = () => json(signedInAs(7));
    usageAnswer = () => json(usage(42));
    const queryClient = newClient();
    const readsAfterSignOut: Array<number | null> = [];
    let signedOutNow = false;

    const { result } = renderHook(
      () => {
        const session = useUserLocals().data;
        const value = useCardUsage(session?.user?.id != null);
        if (signedOutNow && session?.user == null) {
          readsAfterSignOut.push(value?.cards_used ?? null);
        }
        return value;
      },
      { wrapper: wrapperFor(queryClient) }
    );
    await waitFor(() => expect(result.current?.cards_used).toBe(42));

    sessionAnswer = () => json(signedOut);
    signedOutNow = true;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['userLocals'] });
    });
    await waitFor(() => expect(result.current).toBeNull());

    expect(readsAfterSignOut.length).toBeGreaterThan(0);
    expect(readsAfterSignOut).toEqual(readsAfterSignOut.map(() => null));
    expect(usageRequests()).toBe(1);
  });

  it('shares one request between the account menu and the upload form once the session is loaded', async () => {
    sessionAnswer = () => json(signedInAs(7));
    usageAnswer = () => json(usage(42));
    const queryClient = newClient();
    await queryClient.fetchQuery({
      queryKey: ['userLocals'],
      queryFn: async () => signedInAs(7),
    });
    const reads: Record<string, number | undefined> = {};

    function Reader({ name }: Readonly<{ name: string }>) {
      reads[name] = useCardUsage(true)?.cards_used;
      return null;
    }

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Reader, { name: 'accountMenu' }),
        createElement(Reader, { name: 'uploadForm' })
      )
    );

    await waitFor(() =>
      expect(reads).toEqual({ accountMenu: 42, uploadForm: 42 })
    );
    expect(usageRequests()).toBe(1);
    expect(cachedUnder(queryClient, 7)).toEqual(usage(42));
  });
});

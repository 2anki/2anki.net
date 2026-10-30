import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPassToken, storePassToken } from '../anonymousPass';
import { getUserLocals, resetLastDeckMoveForTests } from './getUserLocals';
import {
  getLastDeckStore,
  resetLastDeckStoreForTests,
} from '../upload/lastDeck';

describe('getUserLocals', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('indexedDB', undefined);
    resetLastDeckStoreForTests();
    resetLastDeckMoveForTests();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ locals: {} }), { status: 200 })
    );
  });

  afterEach(() => {
    clearPassToken();
    fetchSpy.mockReset();
    vi.unstubAllGlobals();
    resetLastDeckStoreForTests();
  });

  it('sends the stored pass token so a pass bought before signing up moves to the account', async () => {
    storePassToken('cs_bought_anon');

    await getUserLocals();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('users/debug/locals'),
      expect.objectContaining({
        credentials: 'include',
        headers: { 'X-Pass-Claim': 'cs_bought_anon' },
      })
    );
  });

  it('sends no pass header when no pass was bought in this browser', async () => {
    await getUserLocals();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('users/debug/locals'),
      expect.objectContaining({ credentials: 'include', headers: undefined })
    );
  });

  it('forgets a signed-out deck once the visitor is signed in', async () => {
    await getLastDeckStore().save(keptDeck());
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ locals: {}, user: { id: 9 } }), {
        status: 200,
      })
    );

    await getUserLocals();

    await vi.waitFor(async () =>
      expect(await getLastDeckStore().load()).toBeNull()
    );
  });

  it('moves a signed-out deck into the account once the visitor is signed in', async () => {
    await getLastDeckStore().save(keptDeck());
    fetchSpy.mockImplementation(async (url: string) =>
      url.endsWith('upload/claim/recovery')
        ? new Response(JSON.stringify({ downloadKey: 'k.apkg' }), {
            status: 200,
          })
        : signedInLocals()
    );

    await getUserLocals();

    await vi.waitFor(() => expect(claimCalls()).toHaveLength(1));
    expect(claimCalls()[0][1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({
        recoveryToken: keptDeck().recoveryToken,
        deckName: 'Biology.apkg',
      }),
    });
    await vi.waitFor(async () =>
      expect(await getLastDeckStore().load()).toBeNull()
    );
  });

  it('posts the deck once when two reads land together', async () => {
    await getLastDeckStore().save(keptDeck());
    fetchSpy.mockImplementation(async (url: string) =>
      url.endsWith('upload/claim/recovery')
        ? new Response('{}', { status: 200 })
        : signedInLocals()
    );

    await Promise.all([getUserLocals(), getUserLocals()]);

    await vi.waitFor(async () =>
      expect(await getLastDeckStore().load()).toBeNull()
    );
    expect(claimCalls()).toHaveLength(1);
  });

  it('forgets the deck when the server no longer has it', async () => {
    await getLastDeckStore().save(keptDeck());
    fetchSpy.mockImplementation(async (url: string) =>
      url.endsWith('upload/claim/recovery')
        ? new Response('{}', { status: 404 })
        : signedInLocals()
    );

    await getUserLocals();

    await vi.waitFor(async () =>
      expect(await getLastDeckStore().load()).toBeNull()
    );
  });

  it('keeps the deck for the next read when the move fails on the server', async () => {
    await getLastDeckStore().save(keptDeck());
    fetchSpy.mockImplementation(async (url: string) =>
      url.endsWith('upload/claim/recovery')
        ? new Response('{}', { status: 503 })
        : signedInLocals()
    );

    await getUserLocals();

    await vi.waitFor(() => expect(claimCalls()).toHaveLength(1));
    await settleClaim();
    expect(await getLastDeckStore().load()).toEqual(keptDeck());
  });

  it('keeps the deck for the next read when the move cannot reach the server', async () => {
    await getLastDeckStore().save(keptDeck());
    fetchSpy.mockImplementation(async (url: string) => {
      if (url.endsWith('upload/claim/recovery')) {
        throw new TypeError('Failed to fetch');
      }
      return signedInLocals();
    });

    await getUserLocals();

    await vi.waitFor(() => expect(claimCalls()).toHaveLength(1));
    await settleClaim();
    expect(await getLastDeckStore().load()).toEqual(keptDeck());
  });

  it('tries a failed move once per page load, not on every read', async () => {
    await getLastDeckStore().save(keptDeck());
    fetchSpy.mockImplementation(async (url: string) =>
      url.endsWith('upload/claim/recovery')
        ? new Response('{}', { status: 503 })
        : signedInLocals()
    );

    await getUserLocals();
    await vi.waitFor(() => expect(claimCalls()).toHaveLength(1));
    await settleClaim();
    await getUserLocals();
    await settleClaim();

    expect(claimCalls()).toHaveLength(1);
    expect(await getLastDeckStore().load()).toEqual(keptDeck());
  });

  it('moves the kept deck into whichever account signs in on this browser, as the pass carry-over does', async () => {
    await getLastDeckStore().save(keptDeck());
    fetchSpy.mockImplementation(async (url: string) =>
      url.endsWith('upload/claim/recovery')
        ? new Response('{}', { status: 200 })
        : new Response(JSON.stringify({ locals: {}, user: { id: 42 } }), {
            status: 200,
          })
    );

    await getUserLocals();

    await vi.waitFor(() => expect(claimCalls()).toHaveLength(1));
    await vi.waitFor(async () =>
      expect(await getLastDeckStore().load()).toBeNull()
    );
  });

  it('forgets a deck the server refuses as malformed', async () => {
    await getLastDeckStore().save(keptDeck());
    fetchSpy.mockImplementation(async (url: string) =>
      url.endsWith('upload/claim/recovery')
        ? new Response('{}', { status: 400 })
        : signedInLocals()
    );

    await getUserLocals();

    await vi.waitFor(async () =>
      expect(await getLastDeckStore().load()).toBeNull()
    );
  });

  it('posts nothing for a signed-in visitor with no signed-out deck', async () => {
    fetchSpy.mockImplementation(async () => signedInLocals());

    await getUserLocals();
    await settleClaim();

    expect(claimCalls()).toHaveLength(0);
  });

  it('keeps the deck while the visitor is signed out', async () => {
    await getLastDeckStore().save(keptDeck());

    await getUserLocals();
    await settleClaim();

    expect(await getLastDeckStore().load()).toEqual(keptDeck());
    expect(claimCalls()).toHaveLength(0);
  });

  function claimCalls() {
    return fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith('upload/claim/recovery')
    );
  }
});

const KEPT_AT = Date.now();

function keptDeck() {
  return {
    recoveryToken: '0b6f2c1e-3a4d-4e5f-8a9b-1c2d3e4f5a6b',
    deckName: 'Biology.apkg',
    savedAt: KEPT_AT,
  };
}

function signedInLocals(): Response {
  return new Response(JSON.stringify({ locals: {}, user: { id: 9 } }), {
    status: 200,
  });
}

async function settleClaim(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

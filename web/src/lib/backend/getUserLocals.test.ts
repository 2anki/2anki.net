import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPassToken, storePassToken } from '../anonymousPass';
import { getUserLocals } from './getUserLocals';
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

    expect(await getLastDeckStore().load()).toBeNull();
  });

  it('keeps the deck while the visitor is signed out', async () => {
    await getLastDeckStore().save(keptDeck());

    await getUserLocals();

    expect(await getLastDeckStore().load()).toEqual(keptDeck());
  });
});

const KEPT_AT = Date.now();

function keptDeck() {
  return {
    recoveryToken: '0b6f2c1e-3a4d-4e5f-8a9b-1c2d3e4f5a6b',
    deckName: 'Biology.apkg',
    savedAt: KEPT_AT,
  };
}

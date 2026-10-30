import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createIndexedDbLastDeckStore,
  createMemoryLastDeckStore,
  forgetLastDeck,
  getLastDeckStore,
  keepLastDeck,
  LAST_DECK_TTL_MS,
  lastDeckExpiresAt,
  resetLastDeckStoreForTests,
  installLastDeckStoreForTests,
  type LastDeck,
} from './lastDeck';

const TOKEN = '0b6f2c1e-3a4d-4e5f-8a9b-1c2d3e4f5a6b';
const LATER_TOKEN = '7d1e2f3a-4b5c-4d6e-8f70-819a2b3c4d5e';

function lastDeck(overrides: Partial<LastDeck> = {}): LastDeck {
  return {
    recoveryToken: TOKEN,
    deckName: 'Biology.apkg',
    savedAt: 1_000,
    ...overrides,
  };
}

describe('createMemoryLastDeckStore', () => {
  it('returns the deck that was kept', async () => {
    const store = createMemoryLastDeckStore(() => 2_000);
    await store.save(lastDeck());
    expect(await store.load()).toEqual(lastDeck());
  });

  it('forgets the deck once it is a day old', async () => {
    const store = createMemoryLastDeckStore(() => 1_000 + LAST_DECK_TTL_MS);
    await store.save(lastDeck());
    expect(await store.load()).toBeNull();
  });

  it('returns nothing after clear', async () => {
    const store = createMemoryLastDeckStore(() => 2_000);
    await store.save(lastDeck());
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});

describe('lastDeckExpiresAt', () => {
  it('is a day after the deck was kept', () => {
    expect(lastDeckExpiresAt(lastDeck({ savedAt: 5_000 }))).toBe(
      5_000 + LAST_DECK_TTL_MS
    );
  });
});

describe('keepLastDeck', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetLastDeckStoreForTests();
  });

  it('keeps the deck of a signed-out upload that used a pass', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const now = Date.now();

    await keepLastDeck(
      { passToken: 'cs_pass', recoveryToken: TOKEN, deckName: 'Biology.apkg' },
      () => now
    );

    expect(await getLastDeckStore().load()).toEqual(lastDeck({ savedAt: now }));
  });

  it('keeps nothing for a signed-out upload without a pass', async () => {
    vi.stubGlobal('indexedDB', undefined);

    await keepLastDeck(
      { passToken: null, recoveryToken: TOKEN, deckName: 'Biology.apkg' },
      () => Date.now()
    );

    expect(await getLastDeckStore().load()).toBeNull();
  });

  it('keeps nothing when the upload sent no recovery token', async () => {
    vi.stubGlobal('indexedDB', undefined);

    await keepLastDeck(
      { passToken: 'cs_pass', recoveryToken: null, deckName: 'Biology.apkg' },
      () => Date.now()
    );

    expect(await getLastDeckStore().load()).toBeNull();
  });

  it('says the deck will survive sign-in when a lasting store saved it', async () => {
    installLastDeckStoreForTests(createMemoryLastDeckStore(), 'lasting');

    await expect(
      keepLastDeck(
        {
          passToken: 'cs_pass',
          recoveryToken: TOKEN,
          deckName: 'Biology.apkg',
        },
        () => Date.now()
      )
    ).resolves.toBe(true);
  });

  it('says the deck will not survive sign-in when only this page holds it', async () => {
    vi.stubGlobal('indexedDB', undefined);

    await expect(
      keepLastDeck(
        {
          passToken: 'cs_pass',
          recoveryToken: TOKEN,
          deckName: 'Biology.apkg',
        },
        () => Date.now()
      )
    ).resolves.toBe(false);
    expect(await getLastDeckStore().load()).toMatchObject({
      recoveryToken: TOKEN,
    });
  });

  it('says the deck will not survive sign-in when the browser refuses the save', async () => {
    const open = vi.fn(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.stubGlobal('indexedDB', { open } as unknown as IDBFactory);

    await expect(
      keepLastDeck(
        {
          passToken: 'cs_pass',
          recoveryToken: TOKEN,
          deckName: 'Biology.apkg',
        },
        () => Date.now()
      )
    ).resolves.toBe(false);
  });

  it('says nothing was kept for an upload without a pass', async () => {
    installLastDeckStoreForTests(createMemoryLastDeckStore(), 'lasting');

    await expect(
      keepLastDeck(
        { passToken: null, recoveryToken: TOKEN, deckName: 'Biology.apkg' },
        () => Date.now()
      )
    ).resolves.toBe(false);
  });

  it('replaces the earlier deck with the later one', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const now = Date.now();

    await keepLastDeck(
      { passToken: 'cs_pass', recoveryToken: TOKEN, deckName: 'Biology.apkg' },
      () => now
    );
    await keepLastDeck(
      {
        passToken: 'cs_pass',
        recoveryToken: LATER_TOKEN,
        deckName: 'Chemistry.apkg',
      },
      () => now + 1
    );

    expect(await getLastDeckStore().load()).toEqual({
      recoveryToken: LATER_TOKEN,
      deckName: 'Chemistry.apkg',
      savedAt: now + 1,
    });
  });
});

describe('getLastDeckStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetLastDeckStoreForTests();
  });

  it('reads a refused browser store as no deck', async () => {
    const open = vi.fn(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.stubGlobal('indexedDB', { open } as unknown as IDBFactory);
    const store = getLastDeckStore();

    await expect(store.save(lastDeck())).resolves.toBeUndefined();
    await expect(store.load()).resolves.toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
    expect(open).toHaveBeenCalled();
  });
});

describe('createIndexedDbLastDeckStore', () => {
  it('rejects when the database cannot be opened, for the caller to absorb', async () => {
    const factory = {
      open: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    } as unknown as IDBFactory;
    const store = createIndexedDbLastDeckStore(factory);
    await expect(store.load()).rejects.toThrow('blocked');
  });
});

describe('forgetLastDeck', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetLastDeckStoreForTests();
  });

  it('removes the kept deck', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await getLastDeckStore().save(lastDeck({ savedAt: Date.now() }));

    await forgetLastDeck();

    expect(await getLastDeckStore().load()).toBeNull();
  });

  it('moves on when the browser store never answers', async () => {
    vi.useFakeTimers();
    const open = vi.fn(() => ({}) as IDBOpenDBRequest);
    vi.stubGlobal('indexedDB', { open } as unknown as IDBFactory);

    const forgotten = forgetLastDeck(500);
    await vi.advanceTimersByTimeAsync(500);

    await expect(forgotten).resolves.toBeUndefined();
  });
});

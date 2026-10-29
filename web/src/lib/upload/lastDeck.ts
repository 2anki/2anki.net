import { runRequest } from './pendingUpload';

// A signed-out visitor who paid for a pass gets the deck only as the response
// to the upload. The server keeps a copy for a day under the upload's recovery
// token, so this device remembers that token and the deck's name to offer the
// deck again. It sits in the pending-upload database under its own key, holds
// one deck at a time, and is cleared on sign-in, logout and account deletion.

export interface LastDeck {
  recoveryToken: string;
  deckName: string;
  savedAt: number;
}

export interface LastDeckStore {
  save(deck: LastDeck): Promise<void>;
  load(): Promise<LastDeck | null>;
  clear(): Promise<void>;
}

export const LAST_DECK_TTL_MS = 24 * 60 * 60 * 1000;

const RECORD_KEY = 'lastDeck';

export function lastDeckExpiresAt(deck: LastDeck): number {
  return deck.savedAt + LAST_DECK_TTL_MS;
}

function isFresh(deck: LastDeck, now: number): boolean {
  return now < lastDeckExpiresAt(deck);
}

export function createMemoryLastDeckStore(
  now: () => number = Date.now
): LastDeckStore {
  let current: LastDeck | null = null;
  return {
    save: async (deck) => {
      current = deck;
    },
    load: async () => {
      if (current != null && !isFresh(current, now())) current = null;
      return current;
    },
    clear: async () => {
      current = null;
    },
  };
}

export function createIndexedDbLastDeckStore(
  factory: IDBFactory,
  now: () => number = Date.now
): LastDeckStore {
  return {
    save: async (deck) => {
      await runRequest(factory, 'readwrite', (store) =>
        store.put(deck, RECORD_KEY)
      );
    },
    load: async () => {
      const deck = (await runRequest(factory, 'readonly', (store) =>
        store.get(RECORD_KEY)
      )) as LastDeck | undefined;
      if (deck == null) return null;
      if (isFresh(deck, now())) return deck;
      await runRequest(factory, 'readwrite', (store) =>
        store.delete(RECORD_KEY)
      );
      return null;
    },
    clear: async () => {
      await runRequest(factory, 'readwrite', (store) =>
        store.delete(RECORD_KEY)
      );
    },
  };
}

function quietAndInOrder(store: LastDeckStore): LastDeckStore {
  let tail: Promise<unknown> = Promise.resolve();
  const inOrder = <T>(operation: () => Promise<T>, fallback: T): Promise<T> => {
    const next = tail.then(operation).catch(() => fallback);
    tail = next;
    return next;
  };
  return {
    save: (deck) => inOrder(() => store.save(deck), undefined),
    load: () => inOrder(() => store.load(), null),
    clear: () => inOrder(() => store.clear(), undefined),
  };
}

let defaultStore: LastDeckStore | null = null;

export function getLastDeckStore(): LastDeckStore {
  if (defaultStore == null) {
    const factory = globalThis.indexedDB;
    defaultStore = quietAndInOrder(
      factory == null
        ? createMemoryLastDeckStore()
        : createIndexedDbLastDeckStore(factory)
    );
  }
  return defaultStore;
}

interface FinishedUpload {
  passToken: string | null;
  recoveryToken: string | null;
  deckName: string;
}

export function keepLastDeck(
  upload: FinishedUpload,
  now: () => number = Date.now
): Promise<void> {
  if (upload.passToken == null || upload.recoveryToken == null) {
    return Promise.resolve();
  }
  return getLastDeckStore().save({
    recoveryToken: upload.recoveryToken,
    deckName: upload.deckName,
    savedAt: now(),
  });
}

export function forgetLastDeck(waitMs = 500): Promise<void> {
  return Promise.race([
    getLastDeckStore().clear(),
    new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
  ]);
}

export function resetLastDeckStoreForTests(): void {
  defaultStore = null;
}

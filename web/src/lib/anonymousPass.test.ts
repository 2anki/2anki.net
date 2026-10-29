import {
  getStoredPassToken,
  storePassToken,
  clearPassToken,
} from './anonymousPass';
import {
  getLastDeckStore,
  resetLastDeckStoreForTests,
} from './upload/lastDeck';

describe('anonymousPass', () => {
  const mockStorage: Record<string, string> = {};
  const localStorageMock = {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, value: string) => {
      mockStorage[key] = value;
    },
    removeItem: (key: string) => {
      delete mockStorage[key];
    },
  };

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
    clearPassToken();
  });

  it('returns null when no token is stored', () => {
    expect(getStoredPassToken()).toBeNull();
  });

  it('stores and retrieves a pass token', () => {
    storePassToken('cs_test_123');
    expect(getStoredPassToken()).toBe('cs_test_123');
  });

  it('clears a stored token', () => {
    storePassToken('cs_test_456');
    clearPassToken();
    expect(getStoredPassToken()).toBeNull();
  });

  it('forgets the deck the pass bought on this device', async () => {
    resetLastDeckStoreForTests();
    vi.stubGlobal('indexedDB', undefined);
    await getLastDeckStore().save({
      recoveryToken: '0b6f2c1e-3a4d-4e5f-8a9b-1c2d3e4f5a6b',
      deckName: 'Biology.apkg',
      savedAt: Date.now(),
    });

    clearPassToken();

    await vi.waitFor(async () =>
      expect(await getLastDeckStore().load()).toBeNull()
    );
    vi.unstubAllGlobals();
    resetLastDeckStoreForTests();
  });
});

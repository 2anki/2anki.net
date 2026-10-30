import { vi } from 'vitest';
import {
  ANON_RECOVERY_RETENTION_MS,
  anonRecoveryKey,
} from '../../lib/upload/anonymousRecovery';
import {
  ClaimRecoveryDeckUseCase,
  NoRecoveryDeckError,
  RecoveryDeckNotSavedError,
  type RecoveredDeckSaver,
  type RecoveryDeckStore,
} from './ClaimRecoveryDeckUseCase';

const ANON = 'anon-recovery-1';
const TOKEN = '3f2b8c1e-9a4d-4e7f-8b21-5c6d7e8f9a0b';
const NOW = new Date('2026-10-30T12:00:00Z');
const DECK = Buffer.from('fake-apkg');

function buildStore(objects: Map<string, { body: Buffer; at: Date }>) {
  const store: RecoveryDeckStore = {
    listObjectsByPrefix: vi.fn(async (prefix: string) =>
      [...objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, { at }]) => ({ Key: key, LastModified: at }))
    ),
    getFileContents: vi.fn(async (key: string) => {
      const stored = objects.get(key);
      if (stored == null) {
        const missing = new Error('missing');
        missing.name = 'NoSuchKey';
        throw missing;
      }
      return { Body: stored.body };
    }),
    delete: vi.fn(async (key: string) => objects.delete(key)),
  };
  return store;
}

function storedDeck(ageMs: number, anonId = ANON, token = TOKEN) {
  return new Map([
    [
      anonRecoveryKey(anonId, token),
      { body: DECK, at: new Date(NOW.getTime() - ageMs) },
    ],
  ]);
}

function buildSaver(key: string | null = 'owner-7-deck.apkg') {
  const saveRecoveredDeck = vi.fn().mockResolvedValue(key);
  const saver: RecoveredDeckSaver = { saveRecoveredDeck };
  return { saver, saveRecoveredDeck };
}

function claim(
  useCase: ClaimRecoveryDeckUseCase,
  anonId: string | null = ANON
) {
  return useCase.execute({
    anonId,
    recoveryToken: TOKEN,
    deckName: 'Biology.apkg',
    owner: '7',
    requestId: 'req-1',
  });
}

describe('ClaimRecoveryDeckUseCase', () => {
  it('moves the deck kept for this browser into the account', async () => {
    const objects = storedDeck(60_000);
    const { saver, saveRecoveredDeck } = buildSaver();
    const useCase = new ClaimRecoveryDeckUseCase(
      buildStore(objects),
      saver,
      () => NOW
    );

    const result = await claim(useCase);

    expect(result).toEqual({
      downloadKey: 'owner-7-deck.apkg',
      deckName: 'Biology.apkg',
    });
    expect(saveRecoveredDeck).toHaveBeenCalledWith(
      '7',
      'Biology.apkg',
      DECK,
      'req-1'
    );
    expect(objects.size).toBe(0);
  });

  it('adds no second deck when the same claim arrives again', async () => {
    const objects = storedDeck(60_000);
    const { saver, saveRecoveredDeck } = buildSaver();
    const useCase = new ClaimRecoveryDeckUseCase(
      buildStore(objects),
      saver,
      () => NOW
    );

    await claim(useCase);
    await expect(claim(useCase)).rejects.toBeInstanceOf(NoRecoveryDeckError);
    expect(saveRecoveredDeck).toHaveBeenCalledTimes(1);
  });

  it('accepts a deck a moment before its day runs out', async () => {
    const objects = storedDeck(ANON_RECOVERY_RETENTION_MS - 1);
    const { saver, saveRecoveredDeck } = buildSaver();
    const useCase = new ClaimRecoveryDeckUseCase(
      buildStore(objects),
      saver,
      () => NOW
    );

    await claim(useCase);

    expect(saveRecoveredDeck).toHaveBeenCalledTimes(1);
  });

  it('saves once when two claims for the same deck overlap', async () => {
    const objects = storedDeck(60_000);
    let finishSave: (key: string) => void = () => {};
    const saveRecoveredDeck = vi.fn().mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishSave = resolve;
      })
    );
    const useCase = new ClaimRecoveryDeckUseCase(
      buildStore(objects),
      { saveRecoveredDeck },
      () => NOW
    );

    const first = claim(useCase);
    await vi.waitFor(() => expect(saveRecoveredDeck).toHaveBeenCalledTimes(1));
    await expect(claim(useCase)).rejects.toBeInstanceOf(NoRecoveryDeckError);
    finishSave('owner-7-deck.apkg');

    await expect(first).resolves.toEqual({
      downloadKey: 'owner-7-deck.apkg',
      deckName: 'Biology.apkg',
    });
    expect(saveRecoveredDeck).toHaveBeenCalledTimes(1);
  });

  it('lets the deck be claimed again after a save that failed', async () => {
    const objects = storedDeck(60_000);
    const saveRecoveredDeck = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('owner-7-deck.apkg');
    const useCase = new ClaimRecoveryDeckUseCase(
      buildStore(objects),
      { saveRecoveredDeck },
      () => NOW
    );

    await expect(claim(useCase)).rejects.toBeInstanceOf(
      RecoveryDeckNotSavedError
    );
    await expect(claim(useCase)).resolves.toMatchObject({
      downloadKey: 'owner-7-deck.apkg',
    });
  });

  it('moves the deck into whichever account claims it from the uploading browser', async () => {
    const { saver, saveRecoveredDeck } = buildSaver('owner-8-deck.apkg');
    const useCase = new ClaimRecoveryDeckUseCase(
      buildStore(storedDeck(60_000)),
      saver,
      () => NOW
    );

    await useCase.execute({
      anonId: ANON,
      recoveryToken: TOKEN,
      deckName: 'Biology.apkg',
      owner: '8',
      requestId: undefined,
    });

    expect(saveRecoveredDeck).toHaveBeenCalledWith(
      '8',
      'Biology.apkg',
      DECK,
      undefined
    );
  });

  it('still answers with the saved deck when the kept copy cannot be deleted', async () => {
    const objects = storedDeck(60_000);
    const store = buildStore(objects);
    vi.mocked(store.delete).mockResolvedValueOnce(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const useCase = new ClaimRecoveryDeckUseCase(
      store,
      buildSaver().saver,
      () => NOW
    );

    await expect(claim(useCase)).resolves.toMatchObject({
      downloadKey: 'owner-7-deck.apkg',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).not.toContain(TOKEN);
    warn.mockRestore();
  });

  it('refuses a deck kept for longer than the day it is offered', async () => {
    const objects = storedDeck(ANON_RECOVERY_RETENTION_MS + 1);
    const { saver, saveRecoveredDeck } = buildSaver();
    const useCase = new ClaimRecoveryDeckUseCase(
      buildStore(objects),
      saver,
      () => NOW
    );

    await expect(claim(useCase)).rejects.toBeInstanceOf(NoRecoveryDeckError);
    expect(saveRecoveredDeck).not.toHaveBeenCalled();
  });

  it('never reaches a deck another browser kept under the same token', async () => {
    const objects = storedDeck(60_000, 'someone-else');
    const { saver, saveRecoveredDeck } = buildSaver();
    const useCase = new ClaimRecoveryDeckUseCase(
      buildStore(objects),
      saver,
      () => NOW
    );

    await expect(claim(useCase)).rejects.toBeInstanceOf(NoRecoveryDeckError);
    expect(saveRecoveredDeck).not.toHaveBeenCalled();
    expect(objects.size).toBe(1);
  });

  it('finds nothing without an anon_id cookie', async () => {
    const { saver } = buildSaver();
    const useCase = new ClaimRecoveryDeckUseCase(
      buildStore(storedDeck(60_000)),
      saver,
      () => NOW
    );

    await expect(claim(useCase, null)).rejects.toBeInstanceOf(
      NoRecoveryDeckError
    );
  });

  it('finds nothing when the object disappears between listing and reading', async () => {
    const objects = storedDeck(60_000);
    const store = buildStore(objects);
    vi.mocked(store.getFileContents).mockImplementationOnce(async () => {
      const missing = new Error('gone');
      missing.name = 'NoSuchKey';
      throw missing;
    });
    const useCase = new ClaimRecoveryDeckUseCase(
      store,
      buildSaver().saver,
      () => NOW
    );

    await expect(claim(useCase)).rejects.toBeInstanceOf(NoRecoveryDeckError);
  });

  it('keeps the browser copy when the account copy cannot be saved', async () => {
    const objects = storedDeck(60_000);
    const useCase = new ClaimRecoveryDeckUseCase(
      buildStore(objects),
      buildSaver(null).saver,
      () => NOW
    );

    await expect(claim(useCase)).rejects.toBeInstanceOf(
      RecoveryDeckNotSavedError
    );
    expect(objects.size).toBe(1);
  });
});

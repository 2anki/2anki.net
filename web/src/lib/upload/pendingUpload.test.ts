import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createIndexedDbPendingUploadStore,
  createMemoryPendingUploadStore,
  getPendingUploadStore,
  PENDING_UPLOAD_MAX_BYTES,
  PENDING_UPLOAD_TTL_MS,
  resetPendingUploadStoreForTests,
  withinStorableSize,
  type PendingUpload,
} from './pendingUpload';

function pending(overrides: Partial<PendingUpload> = {}): PendingUpload {
  return {
    files: [new File(['x'], 'lecture.pdf')],
    filename: 'lecture.pdf',
    sizeBytes: 1,
    submittedAt: 1_000,
    recoveryToken: null,
    signedIn: false,
    pdfPageRange: null,
    ...overrides,
  };
}

function bigFile(bytes: number): File {
  const file = new File(['x'], 'big.pdf');
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

describe('createMemoryPendingUploadStore', () => {
  it('returns what was saved', async () => {
    const store = createMemoryPendingUploadStore(() => 2_000);
    await store.save(pending());
    expect(await store.load()).toMatchObject({ filename: 'lecture.pdf' });
  });

  it('forgets an upload once it is a day old', async () => {
    const store = createMemoryPendingUploadStore(
      () => 1_000 + PENDING_UPLOAD_TTL_MS
    );
    await store.save(pending());
    expect(await store.load()).toBeNull();
  });

  it('returns nothing after clear', async () => {
    const store = createMemoryPendingUploadStore(() => 2_000);
    await store.save(pending());
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});

describe('withinStorableSize', () => {
  it('keeps files up to the free upload cap', () => {
    const files = [bigFile(PENDING_UPLOAD_MAX_BYTES)];
    expect(withinStorableSize(files)).toBe(files);
  });

  it('drops the files when together they exceed the cap', () => {
    const files = [bigFile(PENDING_UPLOAD_MAX_BYTES), bigFile(1)];
    expect(withinStorableSize(files)).toEqual([]);
  });
});

describe('getPendingUploadStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetPendingUploadStoreForTests();
  });

  it('reads a refused browser store as nothing pending', async () => {
    const open = vi.fn(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.stubGlobal('indexedDB', { open } as unknown as IDBFactory);
    const store = getPendingUploadStore();

    await expect(store.save(pending())).resolves.toBeUndefined();
    await expect(store.load()).resolves.toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
    expect(open).toHaveBeenCalled();
  });

  it('falls back to memory when the browser has no IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const store = getPendingUploadStore();
    await store.save(pending({ submittedAt: Date.now() }));
    expect(await store.load()).toMatchObject({ filename: 'lecture.pdf' });
  });
});

describe('createIndexedDbPendingUploadStore', () => {
  it('rejects when the database cannot be opened, for the caller to absorb', async () => {
    const factory = {
      open: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    } as unknown as IDBFactory;
    const store = createIndexedDbPendingUploadStore(factory);
    await expect(store.load()).rejects.toThrow('blocked');
  });
});

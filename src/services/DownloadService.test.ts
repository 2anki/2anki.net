import { vi } from 'vitest';
import { Readable } from 'node:stream';

import DownloadService, { BUFFERED_COPY_MAX_BYTES } from './DownloadService';
import { ApkgTooLargeError } from './ApkgPreviewService/extractApkg';
import { PREVIEW_MAX_STORED_BYTES } from './ApkgPreviewService/previewMemoryLimits';

function makeService() {
  return new DownloadService({} as never);
}

describe('DownloadService.getFileStream', () => {
  it('returns null when the owner has no such download row', async () => {
    const repo = { getFile: vi.fn().mockResolvedValue(null) };
    const storage = { getFileStream: vi.fn() };
    const service = new DownloadService(repo as never);

    const result = await service.getFileStream(
      'owner-1',
      'deck.apkg',
      storage as never
    );

    expect(result).toBeNull();
    expect(storage.getFileStream).not.toHaveBeenCalled();
  });

  it('opens the stream for the stored key of the matched row', async () => {
    const body = Readable.from([Buffer.from('apkg')]);
    const repo = {
      getFile: vi.fn().mockResolvedValue({ key: 'stored/owner-1/deck.apkg' }),
    };
    const storage = {
      getFileStream: vi.fn().mockResolvedValue({ body, contentLength: 4 }),
    };
    const service = new DownloadService(repo as never);

    const result = await service.getFileStream(
      'owner-1',
      'deck.apkg',
      storage as never
    );

    expect(repo.getFile).toHaveBeenCalledWith('owner-1', 'deck.apkg');
    expect(storage.getFileStream).toHaveBeenCalledWith(
      'stored/owner-1/deck.apkg'
    );
    expect(result).toEqual({ body, contentLength: 4 });
  });
});

describe('DownloadService.getFileBody', () => {
  function storageWithSize(size: number | undefined) {
    return {
      getObjectSize: vi.fn().mockResolvedValue(size),
      getFileContents: vi
        .fn()
        .mockResolvedValue({ Body: Buffer.from('apkg bytes') }),
    };
  }

  const repo = {
    getFile: vi.fn().mockResolvedValue({ key: 'stored/owner-1/deck.apkg' }),
  };

  it('reads a deck at the size limit into memory', async () => {
    const storage = storageWithSize(PREVIEW_MAX_STORED_BYTES);
    const service = new DownloadService(repo as never);

    const body = await service.getFileBody(
      'owner-1',
      'deck.apkg',
      storage as never
    );

    expect(body?.toString()).toBe('apkg bytes');
    expect(storage.getObjectSize).toHaveBeenCalledWith(
      'stored/owner-1/deck.apkg'
    );
  });

  it('refuses a deck over the size limit without reading its body', async () => {
    const storage = storageWithSize(PREVIEW_MAX_STORED_BYTES + 1);
    const service = new DownloadService(repo as never);

    await expect(
      service.getFileBody('owner-1', 'deck.apkg', storage as never)
    ).rejects.toBeInstanceOf(ApkgTooLargeError);
    expect(storage.getFileContents).not.toHaveBeenCalled();
  });

  it('refuses a deck whose size the storage layer does not report', async () => {
    const storage = storageWithSize(undefined);
    const service = new DownloadService(repo as never);

    await expect(
      service.getFileBody('owner-1', 'deck.apkg', storage as never)
    ).rejects.toBeInstanceOf(ApkgTooLargeError);
    expect(storage.getFileContents).not.toHaveBeenCalled();
  });

  it('returns null without touching storage when the owner has no such row', async () => {
    const storage = storageWithSize(10);
    const service = new DownloadService({
      getFile: vi.fn().mockResolvedValue(null),
    } as never);

    const body = await service.getFileBody(
      'owner-1',
      'deck.apkg',
      storage as never
    );

    expect(body).toBeNull();
    expect(storage.getObjectSize).not.toHaveBeenCalled();
  });
});

describe('DownloadService.storedDeckSource', () => {
  it('reports the stored size of a deck within the limit', async () => {
    const storage = {
      getObjectSize: vi.fn().mockResolvedValue(4096),
      getFileContents: vi.fn().mockResolvedValue({ Body: Buffer.from('x') }),
    };
    const source = makeService().storedDeckSource(
      'stored/1/deck.apkg',
      storage as never
    );

    expect(await source.storedSize()).toBe(4096);
    expect(storage.getFileContents).not.toHaveBeenCalled();
  });

  it('reads the body under the signal it is given', async () => {
    const storage = {
      getFileContents: vi.fn().mockResolvedValue({ Body: Buffer.from('x') }),
    };
    const source = makeService().storedDeckSource(
      'stored/1/deck.apkg',
      storage as never
    );
    const limit = new AbortController();

    expect((await source.read(limit.signal))?.toString()).toBe('x');
    expect(storage.getFileContents).toHaveBeenCalledWith(
      'stored/1/deck.apkg',
      limit.signal
    );
  });

  it.each([
    PREVIEW_MAX_STORED_BYTES + 1,
    300 * 1024 * 1024,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
  ])('refuses a stored size of %s from its size check', async (size) => {
    const storage = { getObjectSize: vi.fn().mockResolvedValue(size) };
    const source = makeService().storedDeckSource(
      'stored/1/deck.apkg',
      storage as never
    );

    await expect(source.storedSize()).rejects.toBeInstanceOf(ApkgTooLargeError);
  });
});

describe('DownloadService.isTooLargeToBuffer', () => {
  it.each([
    [4096, false],
    [BUFFERED_COPY_MAX_BYTES, false],
    [BUFFERED_COPY_MAX_BYTES + 1, true],
    [undefined, true],
    [Number.NaN, true],
    [-1, true],
  ])('answers %s bytes with %s', async (size, expected) => {
    const storage = { getObjectSize: vi.fn().mockResolvedValue(size) };

    expect(
      await makeService().isTooLargeToBuffer(
        'stored/1/deck.apkg',
        storage as never
      )
    ).toBe(expected);
  });
});

describe('DownloadService.isMissingDownloadError', () => {
  it('matches a NoSuchKey error from the storage SDK', () => {
    const service = makeService();
    const error = Object.assign(new Error('not found'), { name: 'NoSuchKey' });
    expect(service.isMissingDownloadError(error)).toBe(true);
  });

  it('does not match the NotFound name, which only a size check raises', () => {
    const service = makeService();
    const error = Object.assign(new Error('UnknownError'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });
    expect(service.isMissingDownloadError(error)).toBe(false);
  });

  it('does not match a generic error', () => {
    const service = makeService();
    expect(service.isMissingDownloadError(new Error('boom'))).toBe(false);
  });
});

describe('DownloadService.isMissingStoredDeckError', () => {
  it('matches a NoSuchKey error from the storage SDK', () => {
    const service = makeService();
    const error = Object.assign(new Error('not found'), { name: 'NoSuchKey' });
    expect(service.isMissingStoredDeckError(error)).toBe(true);
  });

  it('matches the NotFound error a size check raises for a missing object', () => {
    const service = makeService();
    const error = Object.assign(new Error('UnknownError'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });
    expect(service.isMissingStoredDeckError(error)).toBe(true);
  });

  it('does not match a generic error', () => {
    const service = makeService();
    expect(service.isMissingStoredDeckError(new Error('boom'))).toBe(false);
  });
});

describe('DownloadService.isTransientStorageError', () => {
  it('matches a 5xx response from storage', () => {
    const service = makeService();
    const error = Object.assign(new Error('service unavailable'), {
      name: 'ServiceUnavailable',
      $metadata: { httpStatusCode: 503 },
    });
    expect(service.isTransientStorageError(error)).toBe(true);
  });

  it('matches a storage request timeout', () => {
    const service = makeService();
    const error = Object.assign(new Error('timed out'), {
      name: 'TimeoutError',
    });
    expect(service.isTransientStorageError(error)).toBe(true);
  });

  it('matches a socket reset surfaced via error.code', () => {
    const service = makeService();
    const error = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    expect(service.isTransientStorageError(error)).toBe(true);
  });

  it('matches a socket error nested under error.cause', () => {
    const service = makeService();
    const error = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ETIMEDOUT' },
    });
    expect(service.isTransientStorageError(error)).toBe(true);
  });

  it('does not match a NoSuchKey error', () => {
    const service = makeService();
    const error = Object.assign(new Error('not found'), {
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    });
    expect(service.isTransientStorageError(error)).toBe(false);
  });

  it('does not match a generic error', () => {
    const service = makeService();
    expect(service.isTransientStorageError(new Error('boom'))).toBe(false);
  });
});

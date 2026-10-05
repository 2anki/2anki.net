// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearReloadingFlag,
  isChunkLoadError,
  isReloadingForFreshChunks,
  lazyWithRetry,
  recoverFromChunkError,
  withinChunkReloadCooldown,
} from './chunkReload';

const STORAGE_KEY = '2anki:chunkReload:lastAt';
const RELOADING_FLAG_KEY = '2anki:chunkReload:reloading';
const PER_CHUNK_KEY_PREFIX = '2anki:chunkReload:chunk:';

function makeChunkError(): Error {
  return new TypeError(
    'Failed to fetch dynamically imported module: https://2anki.net/assets/A.js'
  );
}

function makeCssPreloadError(): Error {
  return new Error(
    'Unable to preload CSS for https://2anki.net/assets/A-XYZ.css'
  );
}

function makeModuleScriptError(): Error {
  return new TypeError('Importing a module script failed.');
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

async function readLazyFactory<T>(
  Component: React.LazyExoticComponent<React.ComponentType<T>>
): Promise<unknown> {
  type LazyInternal = {
    _init: (payload: unknown) => unknown;
    _payload: unknown;
  };
  const internal = Component as unknown as LazyInternal;
  try {
    const result = internal._init(internal._payload);
    if (
      result != null &&
      typeof (result as { then?: unknown }).then === 'function'
    ) {
      return await (result as Promise<unknown>);
    }
    return result;
  } catch (e) {
    if (e != null && typeof (e as { then?: unknown }).then === 'function') {
      return await (e as Promise<unknown>);
    }
    throw e;
  }
}

describe('isChunkLoadError', () => {
  it('returns true for a ChunkLoadError by name', () => {
    const err = new Error('Loading chunk 5 failed');
    err.name = 'ChunkLoadError';
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('returns true for "Failed to fetch dynamically imported module" TypeError', () => {
    const err = new TypeError(
      'Failed to fetch dynamically imported module: https://2anki.net/assets/SearchPage-XYZABCDE.js'
    );
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('returns true for "error loading dynamically imported module" TypeError', () => {
    const err = new TypeError(
      'error loading dynamically imported module: https://2anki.net/assets/SearchPage-XYZABCDE.js'
    );
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('returns false for a generic error', () => {
    expect(isChunkLoadError(new Error('boom'))).toBe(false);
  });

  it('returns false for a network error unrelated to chunk loading', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isChunkLoadError('chunk error')).toBe(false);
  });
});

describe('recoverFromChunkError', () => {
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    reloadMock = vi.fn();
    vi.stubGlobal('location', { reload: reloadMock });
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('returns false and does not reload for a non-chunk error', () => {
    const result = recoverFromChunkError(new Error('boom'));
    expect(result).toBe(false);
    expect(reloadMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('triggers reload and returns true on first chunk-load error', () => {
    const err = new TypeError(
      'Failed to fetch dynamically imported module: https://2anki.net/assets/A.js'
    );

    const result = recoverFromChunkError(err);

    expect(result).toBe(true);
    expect(reloadMock).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('writes a numeric timestamp to sessionStorage on first reload', () => {
    const before = Date.now();
    const err = new TypeError(
      'Failed to fetch dynamically imported module: https://2anki.net/assets/A.js'
    );

    recoverFromChunkError(err);

    const stored = Number(sessionStorage.getItem(STORAGE_KEY));
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(Date.now());
  });

  it('does not reload and returns false on second call within the 30s cooldown', () => {
    sessionStorage.setItem(STORAGE_KEY, String(Date.now()));

    const err = new TypeError(
      'Failed to fetch dynamically imported module: https://2anki.net/assets/A.js'
    );

    const result = recoverFromChunkError(err);

    expect(result).toBe(false);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('reloads again after the cooldown window has passed', () => {
    const thirtyOneSecondsAgo = Date.now() - 31_000;
    sessionStorage.setItem(STORAGE_KEY, String(thirtyOneSecondsAgo));

    const err = new TypeError(
      'Failed to fetch dynamically imported module: https://2anki.net/assets/A.js'
    );

    const result = recoverFromChunkError(err);

    expect(result).toBe(true);
    expect(reloadMock).toHaveBeenCalledOnce();
  });
});

describe('isChunkLoadError — new patterns', () => {
  it('returns true for "Unable to preload CSS" Error', () => {
    expect(isChunkLoadError(makeCssPreloadError())).toBe(true);
  });

  it('returns true for "Importing a module script failed" TypeError', () => {
    expect(isChunkLoadError(makeModuleScriptError())).toBe(true);
  });
});

describe('lazyWithRetry', () => {
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    reloadMock = vi.fn();
    vi.stubGlobal('location', { reload: reloadMock });
    setVisibility('visible');
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('returns the imported module when the factory succeeds', async () => {
    const factory = vi.fn(async () => ({
      default: (() => null) as unknown as React.ComponentType<unknown>,
    }));
    const Component = lazyWithRetry(factory, './pages/Foo');

    const result = (await readLazyFactory(Component)) as { default: unknown };

    expect(factory).toHaveBeenCalledOnce();
    expect(typeof result.default).toBe('function');
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('rejects once → reloads the page', async () => {
    const factory = vi.fn(() => Promise.reject(makeChunkError()));
    const Component = lazyWithRetry(factory, './pages/Foo');

    void readLazyFactory(Component);
    await Promise.resolve();
    await Promise.resolve();

    expect(reloadMock).toHaveBeenCalledOnce();
    expect(
      sessionStorage.getItem(`${PER_CHUNK_KEY_PREFIX}./pages/Foo`)
    ).not.toBeNull();
    expect(sessionStorage.getItem(RELOADING_FLAG_KEY)).toBe('1');
  });

  it('rejects twice on the same key in the same session → throws without reloading', async () => {
    sessionStorage.setItem(
      `${PER_CHUNK_KEY_PREFIX}./pages/Foo`,
      String(Date.now())
    );

    const error = makeChunkError();
    const factory = vi.fn(() => Promise.reject(error));
    const Component = lazyWithRetry(factory, './pages/Foo');

    await expect(readLazyFactory(Component)).rejects.toBe(error);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('does not reload when document is hidden', async () => {
    setVisibility('hidden');

    const error = makeChunkError();
    const factory = vi.fn(() => Promise.reject(error));
    const Component = lazyWithRetry(factory, './pages/Foo');

    await expect(readLazyFactory(Component)).rejects.toBe(error);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('rethrows non-chunk errors without reloading', async () => {
    const error = new Error('boom');
    const factory = vi.fn(() => Promise.reject(error));
    const Component = lazyWithRetry(factory, './pages/Foo');

    await expect(readLazyFactory(Component)).rejects.toBe(error);
    expect(reloadMock).not.toHaveBeenCalled();
    expect(
      sessionStorage.getItem(`${PER_CHUNK_KEY_PREFIX}./pages/Foo`)
    ).toBeNull();
  });

  it('reloads once when the chunk loads but is missing a default export', async () => {
    const factory = vi.fn(async () => ({}) as { default: React.ComponentType });
    const Component = lazyWithRetry(factory, './pages/Foo');

    void readLazyFactory(Component);
    await Promise.resolve();
    await Promise.resolve();

    expect(reloadMock).toHaveBeenCalledOnce();
    expect(
      sessionStorage.getItem(`${PER_CHUNK_KEY_PREFIX}./pages/Foo`)
    ).not.toBeNull();
    expect(sessionStorage.getItem(RELOADING_FLAG_KEY)).toBe('1');
  });

  it('reloads once when the chunk resolves to a null module', async () => {
    const factory = vi.fn(
      async () => null as unknown as { default: React.ComponentType }
    );
    const Component = lazyWithRetry(factory, './pages/Foo');

    void readLazyFactory(Component);
    await Promise.resolve();
    await Promise.resolve();

    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it('throws a chunk-load error on a second missing-default load → no reload', async () => {
    sessionStorage.setItem(
      `${PER_CHUNK_KEY_PREFIX}./pages/Foo`,
      String(Date.now())
    );
    const factory = vi.fn(async () => ({}) as { default: React.ComponentType });
    const Component = lazyWithRetry(factory, './pages/Foo');

    await expect(readLazyFactory(Component)).rejects.toSatisfy(
      isChunkLoadError
    );
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('reloads independently for a different chunk key on the same session', async () => {
    sessionStorage.setItem(
      `${PER_CHUNK_KEY_PREFIX}./pages/Foo`,
      String(Date.now())
    );

    const factory = vi.fn(() => Promise.reject(makeChunkError()));
    const Component = lazyWithRetry(factory, './pages/Bar');

    void readLazyFactory(Component);
    await Promise.resolve();
    await Promise.resolve();

    expect(reloadMock).toHaveBeenCalledOnce();
    expect(
      sessionStorage.getItem(`${PER_CHUNK_KEY_PREFIX}./pages/Bar`)
    ).not.toBeNull();
  });
});

describe('reloading flag', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('isReloadingForFreshChunks returns false by default', () => {
    expect(isReloadingForFreshChunks()).toBe(false);
  });

  it('isReloadingForFreshChunks returns true after recoverFromChunkError fires', () => {
    vi.stubGlobal('location', { reload: vi.fn() });
    recoverFromChunkError(makeChunkError());
    expect(isReloadingForFreshChunks()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('clearReloadingFlag removes the flag', () => {
    sessionStorage.setItem(RELOADING_FLAG_KEY, '1');
    clearReloadingFlag();
    expect(isReloadingForFreshChunks()).toBe(false);
  });
});

describe('withinChunkReloadCooldown', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('returns false when no timestamp is stored', () => {
    expect(withinChunkReloadCooldown()).toBe(false);
  });

  it('returns true when a recent timestamp is stored', () => {
    sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
    expect(withinChunkReloadCooldown()).toBe(true);
  });

  it('returns false when the stored timestamp is older than 30s', () => {
    sessionStorage.setItem(STORAGE_KEY, String(Date.now() - 31_000));
    expect(withinChunkReloadCooldown()).toBe(false);
  });
});

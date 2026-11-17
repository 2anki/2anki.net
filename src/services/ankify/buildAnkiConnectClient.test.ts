import { vi } from 'vitest';
import { AnkiConnectTimeoutError } from './AnkiConnectClient';
import {
  ankiConnectFactory,
  ankiConnectSendFactory,
} from './buildAnkiConnectClient';

const slowBodyFetch = vi.fn(
  async (_url: string, init: { signal: AbortSignal }) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new Error('aborted'))
        );
        setTimeout(() => resolve({ result: 6, error: null }), 15_000);
      }),
  })
);

describe('AnkiConnect client factories', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', slowBodyFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('the shared factory lets a slow body finish after the per-call timeout', async () => {
    const pending = ankiConnectFactory('localhost', 8765, null)
      .ping()
      .catch((e) => e);
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(pending).resolves.toBe(6);
  });

  test('the send factory times out a body still arriving after the per-call timeout', async () => {
    const pending = ankiConnectSendFactory('localhost', 8765, null)
      .ping()
      .catch((e) => e);
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(pending).resolves.toBeInstanceOf(AnkiConnectTimeoutError);
  });
});

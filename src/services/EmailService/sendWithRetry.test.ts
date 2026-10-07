import { vi } from 'vitest';
import { sendWithRetry, isTransientSendError } from './sendWithRetry';

const noSleep = () => Promise.resolve();

function sendError(code: number | string): Error {
  return Object.assign(new Error(`send failed ${code}`), { code });
}

describe('isTransientSendError', () => {
  it.each([429, 500, 502, 503, 504])('treats HTTP %s as transient', (code) => {
    expect(isTransientSendError(sendError(code))).toBe(true);
  });

  it.each([400, 401, 403, 413])('treats HTTP %s as permanent', (code) => {
    expect(isTransientSendError(sendError(code))).toBe(false);
  });

  it.each(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'])(
    'treats network code %s as transient',
    (code) => {
      expect(isTransientSendError(sendError(code))).toBe(true);
    }
  );

  it('treats an error without a code as permanent', () => {
    expect(isTransientSendError(new Error('nope'))).toBe(false);
    expect(isTransientSendError(null)).toBe(false);
  });
});

describe('sendWithRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const send = vi.fn().mockResolvedValue('ok');
    await expect(sendWithRetry(send, { sleepFn: noSleep })).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure then succeeds', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(sendError(503))
      .mockResolvedValue('ok');
    await expect(sendWithRetry(send, { sleepFn: noSleep })).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rethrows after exhausting attempts on persistent transient failure', async () => {
    const send = vi.fn().mockRejectedValue(sendError(500));
    await expect(
      sendWithRetry(send, { maxAttempts: 3, sleepFn: noSleep })
    ).rejects.toMatchObject({ code: 500 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('does not retry a permanent failure', async () => {
    const send = vi.fn().mockRejectedValue(sendError(400));
    await expect(
      sendWithRetry(send, { sleepFn: noSleep })
    ).rejects.toMatchObject({ code: 400 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially between attempts', async () => {
    const delays: number[] = [];
    const send = vi.fn().mockRejectedValue(sendError(429));
    await expect(
      sendWithRetry(send, {
        maxAttempts: 3,
        baseDelayMs: 500,
        sleepFn: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
      })
    ).rejects.toBeDefined();
    expect(delays).toEqual([500, 1000]);
  });
});

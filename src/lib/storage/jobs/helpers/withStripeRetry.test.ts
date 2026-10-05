import { vi } from 'vitest';
import { withStripeRetry } from './withStripeRetry';

const rateLimitError = {
  type: 'StripeRateLimitError',
  message: 'rate limited',
};
const genericError = new Error('something else');

describe('withStripeRetry', () => {
  it('returns result when operation succeeds on first attempt', async () => {
    const operation = vi.fn().mockResolvedValue('ok');
    await expect(
      withStripeRetry(operation, 'test', { baseDelayMs: 1 })
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries on StripeRateLimitError and returns result on second attempt', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce('ok');
    await expect(
      withStripeRetry(operation, 'test', { baseDelayMs: 1 })
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-rate-limit errors without retrying', async () => {
    const operation = vi.fn().mockRejectedValue(genericError);
    await expect(
      withStripeRetry(operation, 'test', { baseDelayMs: 1 })
    ).rejects.toBe(genericError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting max attempts on persistent rate limits', async () => {
    const operation = vi.fn().mockRejectedValue(rateLimitError);
    await expect(
      withStripeRetry(operation, 'test', { maxAttempts: 3, baseDelayMs: 1 })
    ).rejects.toBe(rateLimitError);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('retries up to maxAttempts and succeeds on last attempt', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce('recovered');
    await expect(
      withStripeRetry(operation, 'test', { maxAttempts: 3, baseDelayMs: 1 })
    ).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(3);
  });
});

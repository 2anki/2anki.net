import { vi } from 'vitest';

import { DeadlineExceededError, withDeadline } from './withDeadline';

describe('withDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the task result when it finishes in time', async () => {
    await expect(withDeadline(1000, async () => 'done')).resolves.toBe('done');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects at the deadline and aborts the signal even when the task ignores it', async () => {
    let seen: AbortSignal | undefined;
    const pending = withDeadline(1000, (signal) => {
      seen = signal;
      return new Promise(() => undefined);
    });
    const outcome = expect(pending).rejects.toBeInstanceOf(
      DeadlineExceededError
    );

    await vi.advanceTimersByTimeAsync(1000);

    await outcome;
    expect(seen?.aborted).toBe(true);
  });

  it('rejects as soon as the parent signal aborts', async () => {
    const parent = new AbortController();
    const pending = withDeadline(
      1000,
      () => new Promise(() => undefined),
      parent.signal
    );
    const outcome = expect(pending).rejects.toBe('stop');

    parent.abort('stop');

    await outcome;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects at once when the parent signal has already aborted', async () => {
    const parent = new AbortController();
    parent.abort('already');

    await expect(
      withDeadline(1000, () => new Promise(() => undefined), parent.signal)
    ).rejects.toBe('already');
  });
});

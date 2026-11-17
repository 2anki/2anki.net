import { WaitAbandonedError, WeightedSemaphore } from './WeightedSemaphore';

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe('WeightedSemaphore', () => {
  it('grants at once while the total weight fits', async () => {
    const semaphore = new WeightedSemaphore(10);

    await semaphore.acquire(4);
    await semaphore.acquire(6);

    expect(semaphore.inUse).toBe(10);
    expect(semaphore.waiting).toBe(0);
  });

  it('makes a request wait until enough weight is released', async () => {
    const semaphore = new WeightedSemaphore(10);
    const releaseFirst = await semaphore.acquire(8);
    let granted = false;
    const second = semaphore.acquire(5).then((release) => {
      granted = true;
      return release;
    });

    await settle();
    expect(granted).toBe(false);
    expect(semaphore.waiting).toBe(1);

    releaseFirst();
    await second;
    expect(granted).toBe(true);
    expect(semaphore.inUse).toBe(5);
  });

  it('always lets one request run, however heavy', async () => {
    const semaphore = new WeightedSemaphore(10);

    const release = await semaphore.acquire(50);

    expect(semaphore.inUse).toBe(50);
    release();
    expect(semaphore.inUse).toBe(0);
  });

  it('runs a heavy request alone and holds lighter ones behind it', async () => {
    const semaphore = new WeightedSemaphore(10);
    const releaseLight = await semaphore.acquire(2);
    const order: string[] = [];
    const heavy = semaphore.acquire(50).then((release) => {
      order.push('heavy');
      return release;
    });
    const light = semaphore.acquire(1).then((release) => {
      order.push('light');
      return release;
    });

    await settle();
    expect(order).toEqual([]);

    releaseLight();
    const releaseHeavy = await heavy;
    await settle();
    expect(order).toEqual(['heavy']);

    releaseHeavy();
    await light;
    expect(order).toEqual(['heavy', 'light']);
  });

  it('grants waiters in the order they asked', async () => {
    const semaphore = new WeightedSemaphore(1);
    const releaseFirst = await semaphore.acquire(1);
    const order: number[] = [];
    const waiters = [1, 2, 3].map((n) =>
      semaphore.acquire(1).then((release) => {
        order.push(n);
        release();
      })
    );

    releaseFirst();
    await Promise.all(waiters);

    expect(order).toEqual([1, 2, 3]);
  });

  it('ignores a second release of the same grant', async () => {
    const semaphore = new WeightedSemaphore(10);
    const release = await semaphore.acquire(4);
    await semaphore.acquire(3);

    release();
    release();

    expect(semaphore.inUse).toBe(3);
  });

  it('drops a waiter whose signal aborts and lets the next one in', async () => {
    const semaphore = new WeightedSemaphore(1);
    const releaseFirst = await semaphore.acquire(1);
    const gone = new AbortController();
    const abandoned = semaphore.acquire(1, gone.signal);
    const next = semaphore.acquire(1);

    gone.abort();
    await expect(abandoned).rejects.toBeInstanceOf(WaitAbandonedError);
    expect(semaphore.waiting).toBe(1);

    releaseFirst();
    await next;
    expect(semaphore.inUse).toBe(1);
  });

  it('refuses at once when the signal has already aborted', async () => {
    const semaphore = new WeightedSemaphore(10);
    const gone = new AbortController();
    gone.abort();

    await expect(semaphore.acquire(1, gone.signal)).rejects.toBeInstanceOf(
      WaitAbandonedError
    );
    expect(semaphore.inUse).toBe(0);
  });

  it('says whether a request would have to wait', async () => {
    const semaphore = new WeightedSemaphore(10);
    expect(semaphore.wouldWait(50)).toBe(false);

    await semaphore.acquire(8);

    expect(semaphore.wouldWait(2)).toBe(false);
    expect(semaphore.wouldWait(3)).toBe(true);
  });

  it('keeps a granted request when its signal aborts later', async () => {
    const semaphore = new WeightedSemaphore(10);
    const gone = new AbortController();

    await semaphore.acquire(4, gone.signal);
    gone.abort();

    expect(semaphore.inUse).toBe(4);
  });
});

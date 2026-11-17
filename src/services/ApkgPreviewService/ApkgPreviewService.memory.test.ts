import { vi } from 'vitest';

import { buildTinyApkg } from '../../test/fixtures/apkg/buildTinyApkg';
import {
  WaitAbandonedError,
  WeightedSemaphore,
} from '../../lib/rateLimit/WeightedSemaphore';
import ApkgPreviewService, {
  type DeckSource,
  PreviewReadTimedOutError,
} from './ApkgPreviewService';
import { estimateParsedBytes } from './estimateParsedBytes';
import { ParseCacheBudget } from './ParseCacheBudget';
import {
  COLD_LOAD_BUDGET_BYTES,
  COLD_LOAD_MIN_WEIGHT_BYTES,
  PREVIEW_READ_TIME_LIMIT_MS,
} from './previewMemoryLimits';

const MIB = 1024 * 1024;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface HeldRead {
  source: DeckSource;
  started: () => boolean;
  finish: () => void;
  fail: (error: Error) => void;
}

function heldRead(storedBytes: number, log: string[], name: string): HeldRead {
  let started = false;
  let resolve: (bytes: Buffer) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const pending = new Promise<Buffer>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    source: {
      storedSize: async () => storedBytes,
      read: () => {
        started = true;
        log.push(name);
        return pending;
      },
    },
    started: () => started,
    finish: () => resolve(buildTinyApkg(`${name} front`, name)),
    fail: (error) => reject(error),
  };
}

function freshLimits(cacheBudgetBytes = 1024 * MIB) {
  return {
    coldLoads: new WeightedSemaphore(COLD_LOAD_BUDGET_BYTES),
    cacheBudget: new ParseCacheBudget(cacheBudgetBytes),
  };
}

async function tinyDeckEstimate(name = 'x'): Promise<number> {
  const service = new ApkgPreviewService(freshLimits());
  const bytes = buildTinyApkg(`${name} front`, name);
  return estimateParsedBytes(await service.parse('probe', bytes));
}

function countingSource(name: string): {
  source: DeckSource;
  reads: () => number;
} {
  let reads = 0;
  return {
    source: {
      storedSize: async () => 4096,
      read: async () => {
        reads += 1;
        return buildTinyApkg(`${name} front`, name);
      },
    },
    reads: () => reads,
  };
}

describe('ApkgPreviewService cold loads', () => {
  it('reads at most four small decks at once and finishes all of them in order', async () => {
    const service = new ApkgPreviewService(freshLimits());
    const log: string[] = [];
    const reads = ['a', 'b', 'c', 'd', 'e'].map((name) =>
      heldRead(4096, log, name)
    );

    const loads = reads.map((read, index) =>
      service.load(`owner-1:${index}.apkg`, read.source)
    );
    await vi.waitFor(() => expect(log).toHaveLength(4));
    expect(reads[4].started()).toBe(false);

    reads[0].finish();
    await vi.waitFor(() => expect(log).toHaveLength(5));
    for (const read of reads) read.finish();
    const results = await Promise.all(loads);

    expect(log).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(
      results.every((parsed) => parsed?.collection.cards.length === 1)
    ).toBe(true);
  });

  it('runs larger decks together while their stored sizes fit the budget', async () => {
    const service = new ApkgPreviewService(freshLimits());
    const log: string[] = [];
    const half = COLD_LOAD_BUDGET_BYTES / 2;
    const reads = ['a', 'b', 'c'].map((name) => heldRead(half, log, name));

    const loads = reads.map((read, index) =>
      service.load(`owner-1:${index}.apkg`, read.source)
    );
    await vi.waitFor(() => expect(log).toEqual(['a', 'b']));

    reads[0].finish();
    await vi.waitFor(() => expect(log).toEqual(['a', 'b', 'c']));
    reads[1].finish();
    reads[2].finish();
    await Promise.all(loads);
  });

  it('reads a deck larger than the budget alone, then the decks behind it', async () => {
    const service = new ApkgPreviewService(freshLimits());
    const log: string[] = [];
    const small = heldRead(4096, log, 'small');
    const large = heldRead(COLD_LOAD_BUDGET_BYTES + MIB, log, 'large');
    const after = heldRead(4096, log, 'after');

    const loads = [small, large, after].map((read, index) =>
      service.load(`owner-1:${index}.apkg`, read.source)
    );
    await vi.waitFor(() => expect(log).toEqual(['small']));

    small.finish();
    await vi.waitFor(() => expect(log).toEqual(['small', 'large']));
    expect(after.started()).toBe(false);

    large.finish();
    await vi.waitFor(() => expect(log).toEqual(['small', 'large', 'after']));
    after.finish();
    await Promise.all(loads);
  });

  it('lets callers waiting for the same deck share one queued load', async () => {
    const service = new ApkgPreviewService(freshLimits());
    const log: string[] = [];
    const blockers = ['a', 'b', 'c', 'd'].map((name) =>
      heldRead(COLD_LOAD_MIN_WEIGHT_BYTES, log, name)
    );
    const blocked = blockers.map((read, index) =>
      service.load(`owner-1:${index}.apkg`, read.source)
    );
    await vi.waitFor(() => expect(log).toHaveLength(4));
    const shared = heldRead(4096, log, 'shared');

    const waiters = Array.from({ length: 3 }, () =>
      service.load('owner-1:shared.apkg', shared.source)
    );
    blockers[0].finish();
    await vi.waitFor(() => expect(shared.started()).toBe(true));
    shared.finish();
    const results = await Promise.all(waiters);

    expect(log.filter((name) => name === 'shared')).toHaveLength(1);
    expect(new Set(results).size).toBe(1);
    for (const read of blockers) read.finish();
    await Promise.all(blocked);
  });

  it('gives the slot of a failed load to the next deck', async () => {
    const service = new ApkgPreviewService(freshLimits());
    const log: string[] = [];
    const reads = ['a', 'b', 'c', 'd', 'e'].map((name) =>
      heldRead(4096, log, name)
    );
    const loads = reads.map((read, index) =>
      service.load(`owner-1:${index}.apkg`, read.source)
    );
    await vi.waitFor(() => expect(log).toHaveLength(4));

    reads[0].fail(new Error('storage dropped the read'));
    await expect(loads[0]).rejects.toThrow('storage dropped the read');
    await vi.waitFor(() => expect(reads[4].started()).toBe(true));

    for (const read of reads.slice(1)) read.finish();
    await Promise.all(loads.slice(1));
  });

  it('takes no slot when the size check fails', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    const source: DeckSource = {
      storedSize: async () => {
        throw new Error('size check failed');
      },
      read: vi.fn(),
    };

    await expect(service.load('owner-1:x.apkg', source)).rejects.toThrow(
      'size check failed'
    );
    expect(limits.coldLoads.inUse).toBe(0);
    expect(source.read).not.toHaveBeenCalled();
  });

  it('answers a cached deck without waiting for a slot', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    const deck = countingSource('cached');
    await service.load('owner-1:cached.apkg', deck.source);
    await limits.coldLoads.acquire(COLD_LOAD_BUDGET_BYTES);

    const parsed = await service.load('owner-1:cached.apkg', deck.source);

    expect(parsed?.collection.cards).toHaveLength(1);
    expect(deck.reads()).toBe(1);
  });

  it('drops a queued load once every caller waiting for it has gone', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    const release = await limits.coldLoads.acquire(COLD_LOAD_BUDGET_BYTES);
    const deck = countingSource('gone');
    const first = new AbortController();
    const second = new AbortController();

    const loads = [
      service.load('owner-1:gone.apkg', deck.source, first.signal),
      service.load('owner-1:gone.apkg', deck.source, second.signal),
    ];
    await vi.waitFor(() => expect(limits.coldLoads.waiting).toBe(1));
    first.abort();
    second.abort();

    for (const load of loads) {
      await expect(load).rejects.toBeInstanceOf(WaitAbandonedError);
    }
    expect(limits.coldLoads.waiting).toBe(0);
    release();
    expect(deck.reads()).toBe(0);
  });

  it('keeps a queued load while one caller for it is still waiting', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    const release = await limits.coldLoads.acquire(COLD_LOAD_BUDGET_BYTES);
    const deck = countingSource('kept');
    const gone = new AbortController();
    const stays = new AbortController();

    const abandoned = service.load(
      'owner-1:kept.apkg',
      deck.source,
      gone.signal
    );
    const kept = service.load('owner-1:kept.apkg', deck.source, stays.signal);
    await vi.waitFor(() => expect(limits.coldLoads.waiting).toBe(1));
    gone.abort();
    release();

    expect((await kept)?.collection.cards).toHaveLength(1);
    expect(await abandoned).toBe(await kept);
    expect(deck.reads()).toBe(1);
  });

  it('starts a fresh load for a caller who arrives after the others left', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    const release = await limits.coldLoads.acquire(COLD_LOAD_BUDGET_BYTES);
    const deck = countingSource('again');
    const gone = new AbortController();

    const abandoned = service.load(
      'owner-1:again.apkg',
      deck.source,
      gone.signal
    );
    await vi.waitFor(() => expect(limits.coldLoads.waiting).toBe(1));
    gone.abort();
    await expect(abandoned).rejects.toBeInstanceOf(WaitAbandonedError);
    const later = service.load('owner-1:again.apkg', deck.source);
    release();

    expect((await later)?.collection.cards).toHaveLength(1);
    expect(deck.reads()).toBe(1);
  });
});

describe('ApkgPreviewService storage read time limit', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hands the slot to the next waiter once a stalled read passes the time limit, and caches nothing', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    const log: string[] = [];
    const stalled = heldRead(COLD_LOAD_BUDGET_BYTES, log, 'stalled');
    const next = heldRead(4096, log, 'next');

    const timedOut = service
      .load('owner-1:stalled.apkg', stalled.source)
      .catch((error: unknown) => error);
    const waiting = service.load('owner-1:next.apkg', next.source);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['stalled']);

    await vi.advanceTimersByTimeAsync(PREVIEW_READ_TIME_LIMIT_MS - 1);
    expect(log).toEqual(['stalled']);
    await vi.advanceTimersByTimeAsync(1);

    expect(await timedOut).toBeInstanceOf(PreviewReadTimedOutError);
    expect(log).toEqual(['stalled', 'next']);
    next.finish();
    expect((await waiting)?.collection.cards).toHaveLength(1);
    expect(limits.cacheBudget.totalBytes).toBe(await tinyDeckEstimate('next'));
  });

  it('aborts the signal it gave the read at the time limit', async () => {
    const service = new ApkgPreviewService(freshLimits());
    let readSignal: AbortSignal | undefined;
    const source: DeckSource = {
      storedSize: async () => 4096,
      read: (signal) => {
        readSignal = signal;
        return new Promise<Buffer>(() => {});
      },
    };

    const timedOut = service
      .load('owner-1:stalled.apkg', source)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(readSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(PREVIEW_READ_TIME_LIMIT_MS);

    expect(readSignal?.aborted).toBe(true);
    expect(await timedOut).toBeInstanceOf(PreviewReadTimedOutError);
  });

  it('reads the deck again on the next request after a timed-out read', async () => {
    const service = new ApkgPreviewService(freshLimits());
    const log: string[] = [];
    const stalled = heldRead(4096, log, 'retry');
    const timedOut = service
      .load('owner-1:retry.apkg', stalled.source)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(PREVIEW_READ_TIME_LIMIT_MS);
    expect(await timedOut).toBeInstanceOf(PreviewReadTimedOutError);

    const retried = service.load(
      'owner-1:retry.apkg',
      countingSource('retry').source
    );

    expect((await retried)?.collection.cards).toHaveLength(1);
  });

  it('stops a running read once every caller waiting for it has gone', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    let readSignal: AbortSignal | undefined;
    const source: DeckSource = {
      storedSize: async () => 4096,
      read: (signal) => {
        readSignal = signal;
        return new Promise<Buffer>(() => {});
      },
    };
    const gone = new AbortController();

    const load = service.load('owner-1:left.apkg', source, gone.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(limits.coldLoads.inUse).toBe(COLD_LOAD_MIN_WEIGHT_BYTES);
    gone.abort();

    await expect(load).rejects.toBeInstanceOf(WaitAbandonedError);
    expect(readSignal?.aborted).toBe(true);
    expect(limits.coldLoads.inUse).toBe(0);
  });
});

describe('ApkgPreviewService cache byte budget', () => {
  it('evicts the least recently used deck across caches once the total passes the budget', async () => {
    const perDeck = await tinyDeckEstimate();
    const limits = freshLimits(Math.floor(perDeck * 2.5));
    const first = new ApkgPreviewService(limits);
    const second = new ApkgPreviewService(limits);
    const a = countingSource('a');
    const b = countingSource('b');
    const c = countingSource('c');

    await first.load('owner-1:a.apkg', a.source);
    await second.load('share:b', b.source);
    await first.load('owner-1:a.apkg', a.source);
    await first.load('owner-1:c.apkg', c.source);
    await first.load('owner-1:a.apkg', a.source);
    await second.load('share:b', b.source);

    expect(a.reads()).toBe(1);
    expect(b.reads()).toBe(2);
    expect(c.reads()).toBe(1);
  });

  it('serves a deck larger than the whole budget without caching it', async () => {
    const perDeck = await tinyDeckEstimate('big');
    const limits = freshLimits(perDeck - 1);
    const service = new ApkgPreviewService(limits);
    const deck = countingSource('big');

    const firstLoad = await service.load('owner-1:big.apkg', deck.source);
    const secondLoad = await service.load('owner-1:big.apkg', deck.source);

    expect(firstLoad?.collection.cards).toHaveLength(1);
    expect(secondLoad?.collection.cards).toHaveLength(1);
    expect(deck.reads()).toBe(2);
    expect(limits.cacheBudget.totalBytes).toBe(0);
  });

  it('counts only the decks the cache still keeps', async () => {
    const perDeck = await tinyDeckEstimate();
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);

    for (let index = 0; index < 9; index += 1) {
      await service.load(
        `owner-1:${index}.apkg`,
        countingSource(String(index)).source
      );
    }

    expect(limits.cacheBudget.totalBytes).toBe(8 * perDeck);
  });

  it('stops counting a deck once it has expired', async () => {
    const perDeck = await tinyDeckEstimate();
    let now = 1_000_000;
    const limits = { ...freshLimits(), now: () => now };
    const service = new ApkgPreviewService(limits);
    const a = countingSource('a');

    await service.load('owner-1:a.apkg', a.source);
    now += CACHE_TTL_MS + 1;
    await service.load('owner-1:b.apkg', countingSource('b').source);

    expect(limits.cacheBudget.totalBytes).toBe(perDeck);
    await service.load('owner-1:a.apkg', a.source);
    expect(a.reads()).toBe(2);
  });
});

describe('ApkgPreviewService work on a stored deck', () => {
  function heldWork() {
    let finish: (value: string) => void = () => {};
    let fail: (error: Error) => void = () => {};
    const work = vi.fn(
      (_bytes: Buffer) =>
        new Promise<string>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        })
    );
    return {
      work,
      finish: (value: string) => finish(value),
      fail: (error: Error) => fail(error),
    };
  }

  it('runs the work under a place weighed by stored size and gives it back once the work settles', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    const held = heldWork();
    const storedBytes = 200 * MIB;
    const archive = buildTinyApkg('repack front', 'repack');

    const result = service.withStoredDeck(
      { storedSize: async () => storedBytes, read: async () => archive },
      held.work
    );
    await vi.waitFor(() => expect(held.work).toHaveBeenCalledTimes(1));
    expect(limits.coldLoads.inUse).toBe(storedBytes);

    held.finish('packed');

    expect(await result).toBe('packed');
    expect(limits.coldLoads.inUse).toBe(0);
    expect(held.work.mock.calls[0][0]).toBe(archive);
  });

  it('waits behind cold loads that fill the budget and reads only once one ends', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    const log: string[] = [];
    const blockers = ['a', 'b', 'c', 'd'].map((name) =>
      heldRead(4096, log, name)
    );
    const blocked = blockers.map((read, index) =>
      service.load(`owner-1:${index}.apkg`, read.source)
    );
    await vi.waitFor(() => expect(log).toHaveLength(4));
    const deck = countingSource('queued');

    const result = service.withStoredDeck(deck.source, async () => 'done');
    await vi.waitFor(() => expect(limits.coldLoads.waiting).toBe(1));
    expect(deck.reads()).toBe(0);

    blockers[0].finish();
    expect(await result).toBe('done');
    expect(deck.reads()).toBe(1);
    for (const read of blockers) read.finish();
    await Promise.all(blocked);
  });

  it('gives back its place when the work fails', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    const held = heldWork();

    const result = service.withStoredDeck(
      countingSource('fails').source,
      held.work
    );
    await vi.waitFor(() => expect(held.work).toHaveBeenCalledTimes(1));
    held.fail(new Error('repack failed'));

    await expect(result).rejects.toThrow('repack failed');
    expect(limits.coldLoads.inUse).toBe(0);
  });

  it('gives back its place and skips the work when the read fails', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    const log: string[] = [];
    const read = heldRead(4096, log, 'broken');
    const work = vi.fn(async () => 'never');

    const result = service.withStoredDeck(read.source, work);
    await vi.waitFor(() => expect(log).toEqual(['broken']));
    read.fail(new Error('storage dropped the read'));

    await expect(result).rejects.toThrow('storage dropped the read');
    expect(work).not.toHaveBeenCalled();
    expect(limits.coldLoads.inUse).toBe(0);
  });

  it('answers null without running the work when storage has no body', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    const work = vi.fn(async () => 'never');

    const result = await service.withStoredDeck(
      { storedSize: async () => 4096, read: async () => undefined },
      work
    );

    expect(result).toBeNull();
    expect(work).not.toHaveBeenCalled();
    expect(limits.coldLoads.inUse).toBe(0);
  });

  it('takes no place and skips the read when the size check fails', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    const source: DeckSource = {
      storedSize: async () => {
        throw new Error('size check failed');
      },
      read: vi.fn(),
    };

    await expect(
      service.withStoredDeck(source, async () => 'never')
    ).rejects.toThrow('size check failed');
    expect(limits.coldLoads.inUse).toBe(0);
    expect(source.read).not.toHaveBeenCalled();
  });

  it('stops waiting for a place once its caller has gone, without reading', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    const release = await limits.coldLoads.acquire(COLD_LOAD_BUDGET_BYTES);
    const deck = countingSource('left');
    const gone = new AbortController();

    const result = service.withStoredDeck(
      deck.source,
      async () => 'never',
      gone.signal
    );
    await vi.waitFor(() => expect(limits.coldLoads.waiting).toBe(1));
    gone.abort();

    await expect(result).rejects.toBeInstanceOf(WaitAbandonedError);
    release();
    expect(deck.reads()).toBe(0);
    expect(limits.coldLoads.inUse).toBe(0);
  });

  it('keeps nothing in the preview cache', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);

    await service.withStoredDeck(
      countingSource('uncached').source,
      async () => 'done'
    );

    expect(limits.cacheBudget.totalBytes).toBe(0);
  });
});

describe('ApkgPreviewService work on a stored deck, read time limit', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops a stalled read at the time limit and gives back its place', async () => {
    const limits = freshLimits();
    const service = new ApkgPreviewService(limits);
    let readSignal: AbortSignal | undefined;
    const source: DeckSource = {
      storedSize: async () => 4096,
      read: (signal) => {
        readSignal = signal;
        return new Promise<Buffer>(() => {});
      },
    };
    const work = vi.fn(async () => 'never');

    const result = service
      .withStoredDeck(source, work)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(PREVIEW_READ_TIME_LIMIT_MS - 1);
    expect(readSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toBeInstanceOf(PreviewReadTimedOutError);
    expect(readSignal?.aborted).toBe(true);
    expect(work).not.toHaveBeenCalled();
    expect(limits.coldLoads.inUse).toBe(0);
  });
});

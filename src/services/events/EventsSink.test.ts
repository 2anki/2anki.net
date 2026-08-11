import { EventsSink, EVENTS_FLUSH_THRESHOLD } from './EventsSink';
import { IEventsRepository, EventRow } from '../../data_layer/EventsRepository';

function makeFakeRepository() {
  const inserted: EventRow[][] = [];
  const repo: IEventsRepository = {
    insertEvents: jest.fn(async (rows) => {
      inserted.push([...rows]);
    }),
    countByName: jest.fn(async () => 0),
    countDistinctUsers: jest.fn(async () => 0),
    countByNameForUser: jest.fn(async () => 0),
    lastEventAt: jest.fn(async () => null),
    groupPaywallShownByVariantAndSurface: jest.fn(async () => []),
    groupPaywallClicksByVariant: jest.fn(async () => []),
    groupUploadFunnel: jest.fn(async () => []),
    groupUploadFunnelByOrigin: jest.fn(async () => []),
    groupConversionFailedByReason: jest.fn(async () => ({
      paywall: 0,
      empty: 0,
      technical: 0,
    })),
  };
  return { repo, inserted };
}

const baseRow: EventRow = {
  name: 'conversion_succeeded',
  user_id: 1,
  anonymous_id: null,
  props: { source: 'upload' },
};

describe('EventsSink', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not flush when buffer is below threshold', async () => {
    const { repo, inserted } = makeFakeRepository();
    const sink = new EventsSink(repo, { flushThreshold: 3 });
    sink.record(baseRow);
    sink.record(baseRow);
    expect(inserted).toHaveLength(0);
  });

  it('flushes when buffer reaches threshold', async () => {
    const { repo, inserted } = makeFakeRepository();
    const sink = new EventsSink(repo, { flushThreshold: 2 });
    sink.record(baseRow);
    sink.record(baseRow);
    await sink.waitForPendingFlush();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toHaveLength(2);
  });

  it('flushes on timer interval', async () => {
    const { repo, inserted } = makeFakeRepository();
    const sink = new EventsSink(repo, {
      flushThreshold: EVENTS_FLUSH_THRESHOLD,
      flushIntervalMs: 1000,
    });
    sink.start();
    sink.record(baseRow);
    jest.advanceTimersByTime(1001);
    await Promise.resolve();
    sink.stop();
    expect(repo.insertEvents).toHaveBeenCalled();
    expect(inserted[0]).toHaveLength(1);
  });

  it('does not flush on interval when buffer is empty', async () => {
    const { repo } = makeFakeRepository();
    const sink = new EventsSink(repo, { flushIntervalMs: 500 });
    sink.start();
    jest.advanceTimersByTime(600);
    await Promise.resolve();
    sink.stop();
    expect(repo.insertEvents).not.toHaveBeenCalled();
  });

  it('tolerates repository errors without throwing', async () => {
    const repo: IEventsRepository = {
      insertEvents: jest.fn(async () => {
        throw new Error('db down');
      }),
      countByName: jest.fn(async () => 0),
      countDistinctUsers: jest.fn(async () => 0),
      countByNameForUser: jest.fn(async () => 0),
      lastEventAt: jest.fn(async () => null),
      groupPaywallShownByVariantAndSurface: jest.fn(async () => []),
      groupPaywallClicksByVariant: jest.fn(async () => []),
      groupUploadFunnel: jest.fn(async () => []),
      groupUploadFunnelByOrigin: jest.fn(async () => []),
      groupConversionFailedByReason: jest.fn(async () => ({
        paywall: 0,
        empty: 0,
        technical: 0,
      })),
    };
    const sink = new EventsSink(repo, { flushThreshold: 1 });
    sink.record(baseRow);
    await expect(sink.waitForPendingFlush()).resolves.toBeUndefined();
  });

  it('start is idempotent — a second start adds no second timer', () => {
    // This test previously called start twice and stop once with no assertion,
    // so it passed no matter what start() did. A leaked second interval would
    // double every periodic flush; the guard in start() is the thing under test.
    const { repo } = makeFakeRepository();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    try {
      const sink = new EventsSink(repo, { flushIntervalMs: 1000 });

      sink.start();
      sink.start();
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      sink.stop();
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

      // A second stop must not throw or clear anything it does not own.
      sink.stop();
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  describe('signup_origin enrichment', () => {
    it('stamps signup_origin from the resolver onto rows with a user and no origin', async () => {
      const { repo, inserted } = makeFakeRepository();
      const resolver = jest.fn().mockResolvedValue(new Map([[1, '/nclex']]));
      const sink = new EventsSink(repo, {
        flushThreshold: 1,
        signupOriginResolver: resolver,
      });

      sink.record({ ...baseRow, name: 'checkout_completed' });
      await sink.waitForPendingFlush();

      expect(resolver).toHaveBeenCalledWith([1]);
      expect(inserted[0][0].props).toEqual({
        source: 'upload',
        signup_origin: '/nclex',
      });
    });

    it('never overrides an origin the event already carries', async () => {
      const { repo, inserted } = makeFakeRepository();
      const resolver = jest.fn().mockResolvedValue(new Map([[1, '/nclex']]));
      const sink = new EventsSink(repo, {
        flushThreshold: 1,
        signupOriginResolver: resolver,
      });

      sink.record({ ...baseRow, props: { signup_origin: '/mcat' } });
      await sink.waitForPendingFlush();

      expect(resolver).not.toHaveBeenCalled();
      expect(inserted[0][0].props).toEqual({ signup_origin: '/mcat' });
    });

    it('leaves anonymous rows untouched and skips the resolver', async () => {
      const { repo, inserted } = makeFakeRepository();
      const resolver = jest.fn().mockResolvedValue(new Map());
      const sink = new EventsSink(repo, {
        flushThreshold: 1,
        signupOriginResolver: resolver,
      });

      sink.record({ ...baseRow, user_id: null, anonymous_id: 'anon-1' });
      await sink.waitForPendingFlush();

      expect(resolver).not.toHaveBeenCalled();
      expect(inserted[0][0].props).toEqual({ source: 'upload' });
    });

    it('still inserts unenriched rows when the resolver fails', async () => {
      const { repo, inserted } = makeFakeRepository();
      const resolver = jest.fn().mockRejectedValue(new Error('db down'));
      const sink = new EventsSink(repo, {
        flushThreshold: 1,
        signupOriginResolver: resolver,
      });

      sink.record(baseRow);
      await sink.waitForPendingFlush();

      expect(inserted).toHaveLength(1);
      expect(inserted[0][0].props).toEqual({ source: 'upload' });
    });
  });
});

import { scheduleAnkifyPolling } from './scheduleAnkifyPolling';
import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { NoActiveAnkifyClientError } from '../../../usecases/ankify/SendUploadToRacUseCase';
import { SyncNotionPageToRacUseCase } from '../../../usecases/ankify/SyncNotionPageToRacUseCase';
import { AnkifyNotionSubscription } from '../../../entities/ankify';

const sampleSubscription = (
  overrides: Partial<AnkifyNotionSubscription> = {}
): AnkifyNotionSubscription => ({
  id: 1,
  owner: 42,
  ankify_client_id: 1,
  notion_page_id: 'page-id',
  notion_page_title: null,
  notion_page_url: null,
  notion_page_icon: null,
  target_deck: null,
  enabled: true,
  last_polled_at: null,
  last_synced_at: null,
  last_error: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

const makeSubscriptions =
  (): jest.Mocked<AnkifyNotionSubscriptionsRepositoryInterface> =>
    ({
      upsert: jest.fn(),
      listByOwner: jest.fn(),
      listEnabled: jest.fn(),
      findByPageId: jest.fn(),
      findByOwnerAndPageId: jest.fn(),
      findById: jest.fn(),
      setEnabled: jest.fn(),
      deleteById: jest.fn(),
      recordPoll: jest.fn(),
      recordObjectType: jest.fn(),
    }) as unknown as jest.Mocked<AnkifyNotionSubscriptionsRepositoryInterface>;

const makeUseCase = (): jest.Mocked<
  Pick<SyncNotionPageToRacUseCase, 'execute'>
> =>
  ({
    execute: jest.fn(async () => undefined),
  }) as unknown as jest.Mocked<Pick<SyncNotionPageToRacUseCase, 'execute'>>;

const waitForTick = () => jest.advanceTimersByTimeAsync(16);

describe('scheduleAnkifyPolling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('skips a subscription deleted after the enabled snapshot was taken', async () => {
    const subscriptions = makeSubscriptions();
    const useCase = makeUseCase();

    const sub = sampleSubscription({ id: 7, notion_page_id: 'deleted-page' });
    subscriptions.listEnabled.mockResolvedValue([sub]);
    subscriptions.findByOwnerAndPageId.mockResolvedValue(null);

    const timer = scheduleAnkifyPolling(
      subscriptions,
      useCase as unknown as SyncNotionPageToRacUseCase,
      { intervalMs: 5 }
    );

    await waitForTick();

    expect(subscriptions.findByOwnerAndPageId).toHaveBeenCalledWith(
      42,
      'deleted-page'
    );
    expect(useCase.execute).not.toHaveBeenCalled();

    clearInterval(timer);
  });

  test('syncs a subscription that still exists when the tick runs', async () => {
    const subscriptions = makeSubscriptions();
    const useCase = makeUseCase();

    const sub = sampleSubscription({ id: 8, notion_page_id: 'live-page' });
    subscriptions.listEnabled.mockResolvedValue([sub]);
    subscriptions.findByOwnerAndPageId.mockResolvedValue(sub);

    const timer = scheduleAnkifyPolling(
      subscriptions,
      useCase as unknown as SyncNotionPageToRacUseCase,
      { intervalMs: 5 }
    );

    await waitForTick();

    expect(useCase.execute).toHaveBeenCalledWith({
      owner: 42,
      notionPageId: 'live-page',
      knownObjectType: null,
      trigger: 'polling',
    });

    clearInterval(timer);
  });

  test('backs off a subscription whose client has been offline past the lapse window', async () => {
    const subscriptions = makeSubscriptions();
    const useCase = makeUseCase();

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const lapsed = sampleSubscription({
      id: 9,
      notion_page_id: 'lapsed-page',
      last_error: 'Anki client offline — will retry next tick',
      last_synced_at: thirtyDaysAgo,
      last_polled_at: new Date(Date.now() - 5 * 60 * 1000),
    });
    subscriptions.listEnabled.mockResolvedValue([lapsed]);
    subscriptions.findByOwnerAndPageId.mockResolvedValue(lapsed);

    const refreshTopLevelPagesForOwner = jest.fn();
    const timer = scheduleAnkifyPolling(
      subscriptions,
      useCase as unknown as SyncNotionPageToRacUseCase,
      { intervalMs: 5, refreshTopLevelPagesForOwner }
    );

    await waitForTick();

    expect(useCase.execute).not.toHaveBeenCalled();
    expect(refreshTopLevelPagesForOwner).not.toHaveBeenCalled();

    clearInterval(timer);
  });

  test('retries a lapsed offline subscription once the hourly window passes', async () => {
    const subscriptions = makeSubscriptions();
    const useCase = makeUseCase();

    const lapsedButDue = sampleSubscription({
      id: 10,
      notion_page_id: 'lapsed-due-page',
      last_error: 'Anki client offline — will retry next tick',
      last_synced_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      last_polled_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    subscriptions.listEnabled.mockResolvedValue([lapsedButDue]);
    subscriptions.findByOwnerAndPageId.mockResolvedValue(lapsedButDue);

    const timer = scheduleAnkifyPolling(
      subscriptions,
      useCase as unknown as SyncNotionPageToRacUseCase,
      { intervalMs: 5 }
    );

    await waitForTick();

    expect(useCase.execute).toHaveBeenCalledWith({
      owner: 42,
      notionPageId: 'lapsed-due-page',
      knownObjectType: null,
      trigger: 'polling',
    });

    clearInterval(timer);
  });

  test('does not start a second tick while the previous one is still running', async () => {
    const subscriptions = makeSubscriptions();
    const useCase = makeUseCase();

    const sub = sampleSubscription({ id: 10, notion_page_id: 'slow-page' });
    subscriptions.listEnabled.mockResolvedValue([sub]);
    subscriptions.findByOwnerAndPageId.mockResolvedValue(sub);

    useCase.execute.mockImplementation(
      () => new Promise<never>(() => undefined)
    );

    const timer = scheduleAnkifyPolling(
      subscriptions,
      useCase as unknown as SyncNotionPageToRacUseCase,
      { intervalMs: 5 }
    );

    try {
      await waitForTick();
      expect(subscriptions.listEnabled).toHaveBeenCalledTimes(1);
    } finally {
      clearInterval(timer);
    }
  });

  test('resumes ticking after a long tick finishes', async () => {
    const subscriptions = makeSubscriptions();
    const useCase = makeUseCase();

    const sub = sampleSubscription({ id: 11, notion_page_id: 'resume-page' });
    subscriptions.listEnabled.mockResolvedValue([sub]);
    subscriptions.findByOwnerAndPageId.mockResolvedValue(sub);

    const firstSync: { release: () => void } = { release: () => undefined };
    useCase.execute.mockImplementationOnce(
      () =>
        new Promise<never>((resolve) => {
          firstSync.release = () => resolve(undefined as never);
        })
    );

    const timer = scheduleAnkifyPolling(
      subscriptions,
      useCase as unknown as SyncNotionPageToRacUseCase,
      { intervalMs: 5 }
    );

    try {
      await waitForTick();
      expect(subscriptions.listEnabled).toHaveBeenCalledTimes(1);

      firstSync.release();
      await waitForTick();

      expect(subscriptions.listEnabled.mock.calls.length).toBeGreaterThan(1);
    } finally {
      firstSync.release();
      clearInterval(timer);
    }
  });

  test('logs a warning naming the stuck tick age when a tick is skipped', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const subscriptions = makeSubscriptions();
      const useCase = makeUseCase();

      const sub = sampleSubscription({ id: 12, notion_page_id: 'stuck-page' });
      subscriptions.listEnabled.mockResolvedValue([sub]);
      subscriptions.findByOwnerAndPageId.mockResolvedValue(sub);

      useCase.execute.mockImplementation(
        () => new Promise<never>(() => undefined)
      );

      const timer = scheduleAnkifyPolling(
        subscriptions,
        useCase as unknown as SyncNotionPageToRacUseCase,
        { intervalMs: 5 }
      );

      try {
        await waitForTick();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[ankify-polling] tick skipped')
        );
      } finally {
        clearInterval(timer);
      }
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('passes the remembered object type so the sync can skip the doomed page lookup', async () => {
    const subscriptions = makeSubscriptions();
    const useCase = makeUseCase();

    const sub = sampleSubscription({
      id: 9,
      notion_page_id: 'database-page',
      notion_object_type: 'database',
    });
    subscriptions.listEnabled.mockResolvedValue([sub]);
    subscriptions.findByOwnerAndPageId.mockResolvedValue(sub);

    const timer = scheduleAnkifyPolling(
      subscriptions,
      useCase as unknown as SyncNotionPageToRacUseCase,
      { intervalMs: 5 }
    );

    await waitForTick();

    expect(useCase.execute).toHaveBeenCalledWith({
      owner: 42,
      notionPageId: 'database-page',
      knownObjectType: 'database',
      trigger: 'polling',
    });

    clearInterval(timer);
  });

  test('mutes a NoActiveAnkifyClientError after one info line per boot', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const subscriptions = makeSubscriptions();
    const useCase = makeUseCase();

    const sub = sampleSubscription({ id: 9, notion_page_id: 'no-client' });
    subscriptions.listEnabled.mockResolvedValue([sub]);
    subscriptions.findByOwnerAndPageId.mockResolvedValue(sub);
    useCase.execute.mockRejectedValue(new NoActiveAnkifyClientError());

    const timer = scheduleAnkifyPolling(
      subscriptions,
      useCase as unknown as SyncNotionPageToRacUseCase,
      { intervalMs: 5 }
    );

    await waitForTick();
    await waitForTick();
    await waitForTick();

    expect(useCase.execute.mock.calls.length).toBeGreaterThan(1);
    expect(errorSpy).not.toHaveBeenCalled();
    const muteLines = infoSpy.mock.calls.filter(([line]) =>
      String(line).includes('no active Ankify client; muting')
    );
    expect(muteLines).toHaveLength(1);

    clearInterval(timer);
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('still logs an error for a non-client failure', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const subscriptions = makeSubscriptions();
    const useCase = makeUseCase();

    const sub = sampleSubscription({ id: 10, notion_page_id: 'broken' });
    subscriptions.listEnabled.mockResolvedValue([sub]);
    subscriptions.findByOwnerAndPageId.mockResolvedValue(sub);
    useCase.execute.mockRejectedValue(new Error('Notion exploded'));

    const timer = scheduleAnkifyPolling(
      subscriptions,
      useCase as unknown as SyncNotionPageToRacUseCase,
      { intervalMs: 5 }
    );

    await waitForTick();

    expect(errorSpy).toHaveBeenCalledWith(
      '[ankify-polling] sync failed for subscription 10',
      expect.any(Error)
    );

    clearInterval(timer);
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });
});

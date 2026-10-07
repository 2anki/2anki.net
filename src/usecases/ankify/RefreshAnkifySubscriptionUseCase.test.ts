import { vi, type Mocked } from 'vitest';
import {
  RefreshAnkifySubscriptionUseCase,
  RefreshCooldownError,
  SubscriptionNotFoundError,
} from './RefreshAnkifySubscriptionUseCase';
import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import {
  AnkifyClientOfflineSkip,
  SyncNotionPageToRacUseCase,
} from './SyncNotionPageToRacUseCase';
import { AnkiConnectUnreachableError } from '../../services/ankify/AnkiConnectClient';
import { AnkifyNotionSubscription } from '../../entities/ankify';

const sampleSubscription = (
  overrides: Partial<AnkifyNotionSubscription> = {}
): AnkifyNotionSubscription => ({
  id: 7,
  owner: 42,
  ankify_client_id: 1,
  notion_page_id: 'page-abc',
  notion_page_title: 'My Notes',
  notion_page_url: 'https://notion.so/page-abc',
  notion_page_icon: '📓',
  target_deck: null,
  enabled: true,
  last_polled_at: null,
  last_synced_at: null,
  last_error: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

const makeSubscriptionsRepo = (
  subscription: AnkifyNotionSubscription | null
): Mocked<AnkifyNotionSubscriptionsRepositoryInterface> =>
  ({
    upsert: vi.fn(),
    listByOwner: vi.fn(),
    listEnabled: vi.fn(),
    findByPageId: vi.fn(),
    findById: vi.fn(async () => subscription),
    setEnabled: vi.fn(),
    deleteById: vi.fn(),
    recordPoll: vi.fn(),
  }) as unknown as Mocked<AnkifyNotionSubscriptionsRepositoryInterface>;

const makeSyncUseCase = (): Mocked<
  Pick<SyncNotionPageToRacUseCase, 'execute'>
> => ({
  execute: vi.fn(async (_input) => ({
    client: {} as never,
    subscription: sampleSubscription(),
    created: 2,
    updated: 1,
    conflicts: 0,
    unchanged: 5,
    errors: [],
    ankiWebSync: 'synced' as const,
    ankiWebSyncError: null,
    diagnostic: null,
  })),
});

describe('RefreshAnkifySubscriptionUseCase', () => {
  it('throws SubscriptionNotFoundError when the subscription does not exist for that owner', async () => {
    const subs = makeSubscriptionsRepo(null);
    const sync = makeSyncUseCase();
    const useCase = new RefreshAnkifySubscriptionUseCase(
      subs,
      sync as unknown as SyncNotionPageToRacUseCase
    );

    await expect(useCase.execute({ id: 7, owner: 42 })).rejects.toBeInstanceOf(
      SubscriptionNotFoundError
    );
    expect(subs.findById).toHaveBeenCalledWith(7, 42);
    expect(sync.execute).not.toHaveBeenCalled();
  });

  it('delegates to the sync use case with the stored Notion page fields and trigger=manual', async () => {
    const subscription = sampleSubscription({ id: 7, owner: 42 });
    const subs = makeSubscriptionsRepo(subscription);
    const sync = makeSyncUseCase();
    const useCase = new RefreshAnkifySubscriptionUseCase(
      subs,
      sync as unknown as SyncNotionPageToRacUseCase
    );

    const result = await useCase.execute({
      id: 7,
      owner: 42,
      ankiConnectHost: 'localhost',
    });

    expect(sync.execute).toHaveBeenCalledWith({
      owner: 42,
      notionPageId: 'page-abc',
      notionPageTitle: 'My Notes',
      notionPageUrl: 'https://notion.so/page-abc',
      notionPageIcon: '📓',
      knownObjectType: null,
      trigger: 'manual',
      ankiConnectHost: 'localhost',
    });
    expect(result.created).toBe(2);
  });

  it('surfaces an unreachable AnkiConnect when the sync reports the client offline', async () => {
    const subscription = sampleSubscription({ id: 7, owner: 42 });
    const subs = makeSubscriptionsRepo(subscription);
    const sync = {
      execute: vi.fn(async () => new AnkifyClientOfflineSkip(7)),
    };
    const useCase = new RefreshAnkifySubscriptionUseCase(
      subs,
      sync as unknown as SyncNotionPageToRacUseCase
    );

    await expect(useCase.execute({ id: 7, owner: 42 })).rejects.toBeInstanceOf(
      AnkiConnectUnreachableError
    );
  });

  it('throws RefreshCooldownError on a second call inside the cooldown window', async () => {
    const subscription = sampleSubscription();
    const subs = makeSubscriptionsRepo(subscription);
    const sync = makeSyncUseCase();
    let now = 1_000_000;
    const useCase = new RefreshAnkifySubscriptionUseCase(
      subs,
      sync as unknown as SyncNotionPageToRacUseCase,
      30_000,
      () => now
    );

    await useCase.execute({ id: 7, owner: 42 });
    now += 5_000;

    await expect(useCase.execute({ id: 7, owner: 42 })).rejects.toMatchObject({
      name: 'RefreshCooldownError',
      retryAfterSeconds: 25,
    });
    expect(sync.execute).toHaveBeenCalledTimes(1);
  });

  it('allows a second call once the cooldown has elapsed', async () => {
    const subscription = sampleSubscription();
    const subs = makeSubscriptionsRepo(subscription);
    const sync = makeSyncUseCase();
    let now = 1_000_000;
    const useCase = new RefreshAnkifySubscriptionUseCase(
      subs,
      sync as unknown as SyncNotionPageToRacUseCase,
      30_000,
      () => now
    );

    await useCase.execute({ id: 7, owner: 42 });
    now += 30_000;
    await useCase.execute({ id: 7, owner: 42 });

    expect(sync.execute).toHaveBeenCalledTimes(2);
  });

  it('records the cooldown stamp before the underlying sync runs so spam during a long sync is blocked', async () => {
    const subscription = sampleSubscription();
    const subs = makeSubscriptionsRepo(subscription);
    const release: { fn: (() => void) | null } = { fn: null };
    const slowSync = {
      execute: vi.fn(
        (_input) =>
          new Promise<{
            client: never;
            subscription: AnkifyNotionSubscription;
            created: number;
            updated: number;
            conflicts: number;
            unchanged: number;
            errors: string[];
            ankiWebSync: 'synced' | 'failed' | 'skipped';
            ankiWebSyncError: string | null;
          }>((resolve) => {
            release.fn = () =>
              resolve({
                client: {} as never,
                subscription,
                created: 0,
                updated: 0,
                conflicts: 0,
                unchanged: 0,
                errors: [],
                ankiWebSync: 'skipped',
                ankiWebSyncError: null,
              });
          })
      ),
    };
    const useCase = new RefreshAnkifySubscriptionUseCase(
      subs,
      slowSync as unknown as SyncNotionPageToRacUseCase,
      30_000
    );

    const inflight = useCase.execute({ id: 7, owner: 42 });
    await Promise.resolve();

    await expect(useCase.execute({ id: 7, owner: 42 })).rejects.toBeInstanceOf(
      RefreshCooldownError
    );

    release.fn?.();
    await inflight;
  });
});

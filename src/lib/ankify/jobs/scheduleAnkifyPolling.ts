import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { NoActiveAnkifyClientError } from '../../../usecases/ankify/SendUploadToRacUseCase';
import { SyncNotionPageToRacUseCase } from '../../../usecases/ankify/SyncNotionPageToRacUseCase';
import { shouldSkipLapsedOfflinePoll } from '../offlineBackoff';

export const ANKIFY_POLLING_INTERVAL_MS = 5 * 60 * 1000;
// A subscription whose Anki client is gone fails identically every tick until
// someone provisions one (#4236: four rows polled forever). Retry hourly so a
// re-provisioned client picks up within the hour instead of every 5 minutes
// spent on a call that cannot succeed.
export const NO_CLIENT_RETRY_INTERVAL_MS = 60 * 60 * 1000;

export const scheduleAnkifyPolling = (
  subscriptions: AnkifyNotionSubscriptionsRepositoryInterface,
  useCase: SyncNotionPageToRacUseCase,
  options: {
    intervalMs?: number;
    noClientRetryIntervalMs?: number;
    refreshTopLevelPagesForOwner?: (owner: number) => Promise<void> | void;
  } = {}
): NodeJS.Timeout => {
  const intervalMs = options.intervalMs ?? ANKIFY_POLLING_INTERVAL_MS;
  const noClientRetryIntervalMs =
    options.noClientRetryIntervalMs ?? NO_CLIENT_RETRY_INTERVAL_MS;
  const refreshTopLevelPagesForOwner = options.refreshTopLevelPagesForOwner;
  // A subscription with no provisioned Anki client fails every 5-minute tick
  // the same way until someone provisions one — a state, not an incident.
  // One info line per subscription per boot instead of an error per tick
  // (#4203: four dead clients were burying real errors in the prod log).
  const mutedNoClientSubs = new Set<number>();
  const noClientRetryAt = new Map<number, number>();

  const logSyncFailure = (subscriptionId: number, error: unknown): void => {
    if (!(error instanceof NoActiveAnkifyClientError)) {
      console.error(
        `[ankify-polling] sync failed for subscription ${subscriptionId}`,
        error
      );
      return;
    }
    noClientRetryAt.set(subscriptionId, Date.now() + noClientRetryIntervalMs);
    if (mutedNoClientSubs.has(subscriptionId)) {
      return;
    }
    mutedNoClientSubs.add(subscriptionId);
    console.info(
      `[ankify-polling] subscription ${subscriptionId} has no active Ankify client; muting until next boot, retrying hourly`
    );
  };

  const isBackedOffForNoClient = (subscriptionId: number): boolean => {
    const retryAt = noClientRetryAt.get(subscriptionId);
    if (retryAt == null) {
      return false;
    }
    if (Date.now() < retryAt) {
      return true;
    }
    noClientRetryAt.delete(subscriptionId);
    return false;
  };

  type EnabledSubscription = Awaited<
    ReturnType<typeof subscriptions.listEnabled>
  >[number];

  const syncSubscription = async (
    sub: EnabledSubscription
  ): Promise<'skipped' | 'attempted'> => {
    const current = await subscriptions.findByOwnerAndPageId(
      sub.owner,
      sub.notion_page_id
    );
    if (
      current == null ||
      shouldSkipLapsedOfflinePoll(current, new Date()) ||
      isBackedOffForNoClient(sub.id)
    ) {
      return 'skipped';
    }
    await useCase.execute({
      owner: sub.owner,
      notionPageId: sub.notion_page_id,
      knownObjectType: current.notion_object_type ?? null,
      trigger: 'polling',
    });
    return 'attempted';
  };

  const refreshOwnerOnce = async (
    owner: number,
    seenOwners: Set<number>
  ): Promise<void> => {
    if (!refreshTopLevelPagesForOwner || seenOwners.has(owner)) {
      return;
    }
    seenOwners.add(owner);
    try {
      await refreshTopLevelPagesForOwner(owner);
    } catch (error) {
      console.error(
        `[ankify-polling] top-level pages refresh failed for owner ${owner}`,
        error
      );
    }
  };

  const tick = async (): Promise<number> => {
    let active: EnabledSubscription[];
    try {
      active = await subscriptions.listEnabled();
    } catch (error) {
      console.error('[ankify-polling] failed to list subscriptions', error);
      return 0;
    }
    const seenOwners = new Set<number>();
    for (const sub of active) {
      let outcome: 'skipped' | 'attempted' = 'attempted';
      try {
        outcome = await syncSubscription(sub);
      } catch (error) {
        logSyncFailure(sub.id, error);
      }
      if (outcome === 'attempted') {
        await refreshOwnerOnce(sub.owner, seenOwners);
      }
    }
    return active.length;
  };

  // setInterval keeps firing while an async tick is still awaiting, so a tick
  // that outlives the interval would stack unboundedly — each overlapping run
  // holding its own fetched blocks on the main-thread heap (#3926). Single
  // flight: a tick that finds the previous one still running skips, and the
  // skip is logged with the running tick's age so a hung tick is visible in
  // prod logs instead of silent.
  let inFlightSince: number | null = null;

  const guardedTick = async () => {
    if (inFlightSince != null) {
      console.warn(
        `[ankify-polling] tick skipped: previous tick still running after ${
          Date.now() - inFlightSince
        }ms`
      );
      return;
    }
    inFlightSince = Date.now();
    const startedAt = inFlightSince;
    try {
      const subscriptionCount = await tick();
      console.info(
        `[ankify-polling] tick completed in ${Date.now() - startedAt}ms (${subscriptionCount} subscriptions)`
      );
    } catch (error) {
      console.error('[ankify-polling] tick failed', error);
    } finally {
      inFlightSince = null;
    }
  };

  return setInterval(guardedTick, intervalMs);
};

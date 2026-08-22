import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { NoActiveAnkifyClientError } from '../../../usecases/ankify/SendUploadToRacUseCase';
import { SyncNotionPageToRacUseCase } from '../../../usecases/ankify/SyncNotionPageToRacUseCase';
import { shouldSkipLapsedOfflinePoll } from '../offlineBackoff';

export const ANKIFY_POLLING_INTERVAL_MS = 5 * 60 * 1000;

export const scheduleAnkifyPolling = (
  subscriptions: AnkifyNotionSubscriptionsRepositoryInterface,
  useCase: SyncNotionPageToRacUseCase,
  options: {
    intervalMs?: number;
    refreshTopLevelPagesForOwner?: (owner: number) => Promise<void> | void;
  } = {}
): NodeJS.Timeout => {
  const intervalMs = options.intervalMs ?? ANKIFY_POLLING_INTERVAL_MS;
  const refreshTopLevelPagesForOwner = options.refreshTopLevelPagesForOwner;
  // A subscription with no provisioned Anki client fails every 5-minute tick
  // the same way until someone provisions one — a state, not an incident.
  // One info line per subscription per boot instead of an error per tick
  // (#4203: four dead clients were burying real errors in the prod log).
  const mutedNoClientSubs = new Set<number>();

  const tick = async (): Promise<number> => {
    let active: Awaited<ReturnType<typeof subscriptions.listEnabled>>;
    try {
      active = await subscriptions.listEnabled();
    } catch (error) {
      console.error('[ankify-polling] failed to list subscriptions', error);
      return 0;
    }
    const seenOwners = new Set<number>();
    for (const sub of active) {
      try {
        const current = await subscriptions.findByOwnerAndPageId(
          sub.owner,
          sub.notion_page_id
        );
        if (current == null) {
          continue;
        }
        if (shouldSkipLapsedOfflinePoll(current, new Date())) {
          continue;
        }
        await useCase.execute({
          owner: sub.owner,
          notionPageId: sub.notion_page_id,
          knownObjectType: current.notion_object_type ?? null,
          trigger: 'polling',
        });
      } catch (error) {
        if (error instanceof NoActiveAnkifyClientError) {
          if (!mutedNoClientSubs.has(sub.id)) {
            mutedNoClientSubs.add(sub.id);
            console.info(
              `[ankify-polling] subscription ${sub.id} has no active Ankify client; muting until next boot`
            );
          }
        } else {
          console.error(
            `[ankify-polling] sync failed for subscription ${sub.id}`,
            error
          );
        }
      }
      if (refreshTopLevelPagesForOwner && !seenOwners.has(sub.owner)) {
        seenOwners.add(sub.owner);
        try {
          await refreshTopLevelPagesForOwner(sub.owner);
        } catch (error) {
          console.error(
            `[ankify-polling] top-level pages refresh failed for owner ${sub.owner}`,
            error
          );
        }
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

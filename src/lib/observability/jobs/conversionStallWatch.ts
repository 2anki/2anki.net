// A stalled conversion queue produces no error: uploads just wait, and the
// browser gives up after a couple of minutes. Three stalls in three days
// (2026-10-09..11) were only found because a customer wrote in, so this watch
// emails ops as soon as an upload has waited longer than a person will.
export const CONVERSION_STALL_THRESHOLD_MS = 120 * 1000;

export const CONVERSION_STALL_ALERT_COOLDOWN_MS = 60 * 60 * 1000;

export const CONVERSION_STALL_WATCH_INTERVAL_MS = 60 * 1000;

interface StallSample {
  queueSize: number;
  busyBackground: number;
  oldestInteractiveWaitMs: number;
}

interface IntervalHandle {
  unref(): unknown;
}

export interface ConversionStallWatchDeps {
  samplePool: () => StallSample | null;
  sendAlert: (subject: string, body: string) => Promise<void>;
  recordAlert: (waitSeconds: number) => void;
  now?: () => number;
  log?: (line: string) => void;
}

export function createConversionStallWatch(deps: ConversionStallWatchDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.warn(line));
  let stalledSince: number | null = null;
  let lastAlertAt: number | null = null;

  const alert = async (sample: StallSample, waitSeconds: number) => {
    deps.recordAlert(waitSeconds);
    try {
      await deps.sendAlert(
        `[2anki] Uploads waiting ${waitSeconds}s in the conversion queue`,
        `The oldest queued upload has waited ${waitSeconds}s. ` +
          `Queue: ${sample.queueSize} task(s); background (Notion) tasks ` +
          `running: ${sample.busyBackground}. Read the [memory] and ` +
          `[conversion-pool] lines in the pm2 log for the lane split.`
      );
    } catch (error) {
      log(`[conversion-pool] stall alert email failed: ${String(error)}`);
    }
  };

  const tick = async () => {
    const sample = deps.samplePool();
    if (sample == null) return;
    const at = now();
    if (sample.oldestInteractiveWaitMs < CONVERSION_STALL_THRESHOLD_MS) {
      if (stalledSince != null) {
        log(
          `[conversion-pool] stall cleared after ${Math.round((at - stalledSince) / 1000)}s`
        );
        stalledSince = null;
      }
      return;
    }
    stalledSince ??= at;
    const waitSeconds = Math.round(sample.oldestInteractiveWaitMs / 1000);
    log(
      `[conversion-pool] stall oldest_wait_s=${waitSeconds} queue=${sample.queueSize} busy_background=${sample.busyBackground}`
    );
    if (
      lastAlertAt == null ||
      at - lastAlertAt >= CONVERSION_STALL_ALERT_COOLDOWN_MS
    ) {
      lastAlertAt = at;
      await alert(sample, waitSeconds);
    }
  };

  return { tick };
}

export function scheduleConversionStallWatch<H extends IntervalHandle>(
  deps: ConversionStallWatchDeps & {
    setIntervalFn: (tick: () => void, ms: number) => H;
  }
): H {
  const watch = createConversionStallWatch(deps);
  const handle = deps.setIntervalFn(() => {
    void watch.tick();
  }, CONVERSION_STALL_WATCH_INTERVAL_MS);
  handle.unref();
  return handle;
}

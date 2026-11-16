// A conversion child whose subprocess hangs stays busy, the pool grows around
// it, and nothing queues, so the stall watch never fires. On 2026-11-14 two
// children sat like that for 18 hours and were found by reading two log checks
// side by side. This watch emails ops once a task has run far longer than any
// healthy one. It only reports: nothing is killed, because the longest healthy
// background task on record is long enough that a deadline could cut real work.
//
// Thresholds come from eleven days of prod samples (2026-11-05..16). Upload
// work never kept a child busy for more than 9 minutes at a stretch, and one
// Notion conversion ran 108 minutes and finished.
export const LONG_UPLOAD_TASK_THRESHOLD_MS = 30 * 60 * 1000;

export const LONG_BACKGROUND_TASK_THRESHOLD_MS = 4 * 60 * 60 * 1000;

// A hung task stays hung until the process restarts, so the reminder is slow.
export const LONG_TASK_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export const LONG_TASK_WATCH_INTERVAL_MS = 60 * 1000;

interface LongTaskSample {
  longestUploadRunMs: number;
  longestBackgroundRunMs: number;
}

interface IntervalHandle {
  unref(): unknown;
}

export interface ConversionLongTaskWatchDeps {
  samplePool: () => LongTaskSample | null;
  sendAlert: (subject: string, body: string) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

type Lane = 'upload' | 'background';

interface LaneState {
  lane: Lane;
  thresholdMs: number;
  read: (sample: LongTaskSample) => number;
  lastAlertAt: number | null;
}

export function createConversionLongTaskWatch(
  deps: ConversionLongTaskWatchDeps
) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.warn(line));
  const lanes: LaneState[] = [
    {
      lane: 'upload',
      thresholdMs: LONG_UPLOAD_TASK_THRESHOLD_MS,
      read: (sample) => sample.longestUploadRunMs,
      lastAlertAt: null,
    },
    {
      lane: 'background',
      thresholdMs: LONG_BACKGROUND_TASK_THRESHOLD_MS,
      read: (sample) => sample.longestBackgroundRunMs,
      lastAlertAt: null,
    },
  ];

  const alert = async (lane: Lane, minutes: number) => {
    try {
      await deps.sendAlert(
        `[2anki] A conversion has been running for ${minutes} minutes`,
        `The longest-running ${lane} conversion has held its worker for ` +
          `${minutes} minutes. Nothing was stopped. If a subprocess of a ` +
          `conversion worker (pdfimages, pdftoppm, pdfinfo, soffice) is ` +
          `older than the task should be, it is hung, and the worker stays ` +
          `busy until the server process restarts; the next deploy clears it.`
      );
    } catch (error) {
      log(`[conversion-pool] long-task alert email failed: ${String(error)}`);
    }
  };

  const checkLane = async (state: LaneState, runMs: number, at: number) => {
    if (runMs < state.thresholdMs) {
      if (state.lastAlertAt != null) {
        log(`[conversion-pool] long-task cleared lane=${state.lane}`);
        state.lastAlertAt = null;
      }
      return;
    }
    if (
      state.lastAlertAt != null &&
      at - state.lastAlertAt < LONG_TASK_ALERT_COOLDOWN_MS
    ) {
      return;
    }
    state.lastAlertAt = at;
    const minutes = Math.round(runMs / 60_000);
    log(
      `[conversion-pool] long-task lane=${state.lane} running_min=${minutes}`
    );
    await alert(state.lane, minutes);
  };

  const tick = async () => {
    const sample = deps.samplePool();
    if (sample == null) return;
    const at = now();
    for (const state of lanes) {
      await checkLane(state, state.read(sample), at);
    }
  };

  return { tick };
}

export function scheduleConversionLongTaskWatch<H extends IntervalHandle>(
  deps: ConversionLongTaskWatchDeps & {
    setIntervalFn: (tick: () => void, ms: number) => H;
  }
): H {
  const watch = createConversionLongTaskWatch(deps);
  const handle = deps.setIntervalFn(() => {
    void watch.tick();
  }, LONG_TASK_WATCH_INTERVAL_MS);
  handle.unref();
  return handle;
}

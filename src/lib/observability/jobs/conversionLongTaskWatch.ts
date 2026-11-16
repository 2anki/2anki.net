// A conversion child whose subprocess hangs stays busy, the pool grows around
// it, and nothing queues, so the stall watch never fires. On 2026-11-14 two
// children sat like that for 18 hours and were found only because two reads of
// the pm2 [memory] lines, hours apart, showed the same busy count. This watch
// emails ops once a task has run far longer than any healthy one. It only
// reports: nothing is killed, because the longest healthy Notion conversion on
// record is long enough that a deadline could cut real work.
//
// Thresholds come from eleven days of prod samples (2026-11-05..16). Upload
// work never kept a child busy for more than 9 minutes at a stretch, and one
// Notion conversion (the background lane) ran 108 minutes and finished.
export const LONG_UPLOAD_TASK_THRESHOLD_MS = 30 * 60 * 1000;

export const LONG_BACKGROUND_TASK_THRESHOLD_MS = 4 * 60 * 60 * 1000;

// A hung task stays hung until the process restarts, so the reminder is slow.
export const LONG_TASK_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export const LONG_TASK_WATCH_INTERVAL_MS = 60 * 1000;

interface LongTaskSample {
  uploadRunsMs: number[];
  backgroundRunsMs: number[];
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

interface LaneState {
  lane: 'upload' | 'background';
  one: string;
  many: string;
  limit: string;
  thresholdMs: number;
  read: (sample: LongTaskSample) => number[];
  alertedCount: number;
  lastAlertAt: number | null;
}

const toMinutes = (ms: number) => Math.round(ms / 60_000);

const WHAT_TO_DO =
  'Nothing was stopped. On the server, list the subprocesses of the ' +
  'conversion workers (pdfimages, pdftoppm, pdfinfo, soffice): one that has ' +
  'run this long is hung. Its worker stays busy until the server process ' +
  'restarts, so restart it or let the next deploy do it.';

function alertSubject(state: LaneState, count: number): string {
  return count === 1
    ? `[2anki] ${state.one} has run past ${state.limit}`
    : `[2anki] ${count} ${state.many} have run past ${state.limit}`;
}

function alertBody(state: LaneState, count: number, longestMs: number): string {
  const minutes = toMinutes(longestMs);
  const what =
    count === 1
      ? `${state.one} has held a worker for ${minutes} minutes.`
      : `${count} ${state.many} have each held a worker for more than ` +
        `${state.limit}, the longest for ${minutes} minutes.`;
  return `${what} ${WHAT_TO_DO}`;
}

export function createConversionLongTaskWatch(
  deps: ConversionLongTaskWatchDeps
) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.warn(line));
  const lanes: LaneState[] = [
    {
      lane: 'upload',
      one: 'An upload conversion',
      many: 'upload conversions',
      limit: '30 minutes',
      thresholdMs: LONG_UPLOAD_TASK_THRESHOLD_MS,
      read: (sample) => sample.uploadRunsMs,
      alertedCount: 0,
      lastAlertAt: null,
    },
    {
      lane: 'background',
      one: 'A Notion conversion',
      many: 'Notion conversions',
      limit: '4 hours',
      thresholdMs: LONG_BACKGROUND_TASK_THRESHOLD_MS,
      read: (sample) => sample.backgroundRunsMs,
      alertedCount: 0,
      lastAlertAt: null,
    },
  ];

  const checkLane = async (state: LaneState, runsMs: number[], at: number) => {
    const long = runsMs.filter((ms) => ms >= state.thresholdMs);
    if (long.length === 0) {
      if (state.lastAlertAt != null) {
        log(`[conversion-pool] long-task cleared lane=${state.lane}`);
        state.lastAlertAt = null;
        state.alertedCount = 0;
      }
      return;
    }
    // One more long task than last reported is news at once; the same ones
    // still running are only a reminder.
    const isNewTask = long.length > state.alertedCount;
    const reminderDue =
      state.lastAlertAt != null &&
      at - state.lastAlertAt >= LONG_TASK_ALERT_COOLDOWN_MS;
    state.alertedCount = long.length;
    if (!isNewTask && !reminderDue) return;
    state.lastAlertAt = at;
    const longestMs = Math.max(...long);
    log(
      `[conversion-pool] long-task lane=${state.lane} tasks=${long.length} longest_min=${toMinutes(longestMs)}`
    );
    try {
      await deps.sendAlert(
        alertSubject(state, long.length),
        alertBody(state, long.length, longestMs)
      );
    } catch (error) {
      log(`[conversion-pool] long-task alert email failed: ${String(error)}`);
    }
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

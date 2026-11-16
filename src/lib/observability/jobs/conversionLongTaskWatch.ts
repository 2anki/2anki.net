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

interface RunningTask {
  pid: number | null;
  runMs: number;
}

interface LongTaskSample {
  uploadRuns: RunningTask[];
  backgroundRuns: RunningTask[];
}

interface IntervalHandle {
  unref(): unknown;
}

export interface ConversionLongTaskWatchDeps {
  samplePool: () => LongTaskSample | null;
  sendAlert: (subject: string, body: string) => Promise<void>;
  // The pm2 app the pool belongs to. Blue and green each run a pool and a
  // watch, so the email has to say which one to look at.
  processName: string;
  now?: () => number;
  log?: (line: string) => void;
}

interface LaneState {
  lane: 'upload' | 'background';
  one: string;
  many: string;
  limit: string;
  thresholdMs: number;
  read: (sample: LongTaskSample) => RunningTask[];
  alertedCount: number;
  lastAlertAt: number | null;
}

const toMinutes = (ms: number) => Math.round(ms / 60_000);

export function formatRunTime(ms: number): string {
  const minutes = toMinutes(ms);
  if (minutes < 60) return `${minutes} minutes`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const WHAT_TO_DO =
  'Nothing was stopped. On the server, look at the subprocesses of that ' +
  'worker (pdfimages, pdftoppm, pdfinfo, soffice): one that has run this ' +
  'long is hung. Killing it fails the conversion and frees the worker; so ' +
  'does restarting the server process, which the next deploy also does. A ' +
  'Notion conversion can also hang on a network call, with no subprocess ' +
  'to find.';

function alertSubject(
  state: LaneState,
  count: number,
  isReminder: boolean
): string {
  const verb = isReminder ? 'still running past' : 'run past';
  return count === 1
    ? `[2anki] ${state.one} ${isReminder ? 'is' : 'has'} ${verb} ${state.limit}`
    : `[2anki] ${count} ${state.many} ${isReminder ? 'are' : 'have'} ${verb} ${state.limit}`;
}

function describeWorkers(long: RunningTask[]): string {
  return [...long]
    .sort((a, b) => b.runMs - a.runMs)
    .map(
      (task) => `pid ${task.pid ?? 'unknown'} (${formatRunTime(task.runMs)})`
    )
    .join(', ');
}

function alertBody(
  state: LaneState,
  long: RunningTask[],
  processName: string
): string {
  const what =
    long.length === 1
      ? `${state.one} has held a worker for more than ${state.limit}.`
      : `${long.length} ${state.many} have each held a worker for more than ${state.limit}.`;
  const where = `Process ${processName}, worker ${describeWorkers(long)}.`;
  return `${what} ${where} ${WHAT_TO_DO}`;
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
      read: (sample) => sample.uploadRuns,
      alertedCount: 0,
      lastAlertAt: null,
    },
    {
      lane: 'background',
      one: 'A Notion conversion',
      many: 'Notion conversions',
      limit: '4 hours',
      thresholdMs: LONG_BACKGROUND_TASK_THRESHOLD_MS,
      read: (sample) => sample.backgroundRuns,
      alertedCount: 0,
      lastAlertAt: null,
    },
  ];

  const checkLane = async (
    state: LaneState,
    runs: RunningTask[],
    at: number
  ) => {
    const long = runs.filter((task) => task.runMs >= state.thresholdMs);
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
    if (!isNewTask && !reminderDue) {
      state.alertedCount = long.length;
      return;
    }
    const longestMs = Math.max(...long.map((task) => task.runMs));
    log(
      `[conversion-pool] long-task lane=${state.lane} tasks=${long.length} longest_min=${toMinutes(longestMs)}`
    );
    try {
      await deps.sendAlert(
        alertSubject(state, long.length, !isNewTask),
        alertBody(state, long, deps.processName)
      );
      state.alertedCount = long.length;
      state.lastAlertAt = at;
    } catch (error) {
      // The state is left as it was, so the next tick sends this alert again
      // instead of waiting out the cooldown on an email nobody received.
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
  const log = deps.log ?? ((line: string) => console.warn(line));
  const handle = deps.setIntervalFn(() => {
    // The server exits on an unhandled rejection, and a watch must never be
    // the reason it does.
    watch.tick().catch((error) => {
      log(`[conversion-pool] long-task watch failed: ${String(error)}`);
    });
  }, LONG_TASK_WATCH_INTERVAL_MS);
  handle.unref();
  return handle;
}

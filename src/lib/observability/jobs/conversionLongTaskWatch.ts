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

// The mail client sets no timeout of its own. A send that never settles would
// otherwise hold the watch for good.
export const ALERT_SEND_TIMEOUT_MS = 30 * 1000;

// After a failed send the next try waits one minute, then two, four and so
// on up to an hour, so a provider outage during an 18-hour hang is a few log
// lines an hour and not three a minute, and the alert still arrives within
// the hour once the provider is back.
export const ALERT_RETRY_BASE_MS = 60 * 1000;

export const ALERT_RETRY_MAX_MS = 60 * 60 * 1000;

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
  // watch, so the email has to say which one to look at. Unset outside pm2.
  processName?: string;
  now?: () => number;
  log?: (line: string) => void;
}

interface LaneState {
  lane: 'upload' | 'background';
  one: string;
  many: string;
  limit: string;
  hint: string;
  thresholdMs: number;
  read: (sample: LongTaskSample) => RunningTask[];
  alertedCount: number;
  lastAlertAt: number | null;
  failedSends: number;
  retryAt: number;
}

const toMinutes = (ms: number) => Math.round(ms / 60_000);

export function formatRunTime(ms: number): string {
  const minutes = toMinutes(ms);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

const TOOL_HINT =
  'A pdfimages, pdftoppm, pdfinfo or soffice process that has run this long ' +
  'is hung.';

const NOTION_HINT =
  'A Notion conversion can also hang on a network call, with no subprocess ' +
  'to find.';

function listCommand(long: RunningTask[]): string {
  const pids = long.flatMap((task) => (task.pid == null ? [] : [task.pid]));
  const target = pids.length === 0 ? '<worker pid>' : pids.join(',');
  const whose = long.length === 1 ? 'its' : 'their';
  return `On the server, list ${whose} subprocesses: ps --ppid ${target} -o pid,etime,cmd.`;
}

const HOW_TO_FREE =
  'Nothing was stopped. Killing a hung subprocess fails that conversion and ' +
  'frees its worker; restarting the server process frees them all, and the ' +
  'next deploy does that too.';

function firstAlertSubject(state: LaneState, count: number): string {
  return count === 1
    ? `[2anki] ${state.one} has run past ${state.limit}`
    : `[2anki] ${count} ${state.many} have run past ${state.limit}`;
}

function reminderSubject(state: LaneState, count: number): string {
  return count === 1
    ? `[2anki] ${state.one} is still running past ${state.limit}`
    : `[2anki] ${count} ${state.many} are still running past ${state.limit}`;
}

function describeWorkers(long: RunningTask[]): string {
  const workers = [...long]
    .sort((a, b) => b.runMs - a.runMs)
    .map(
      (task) => `pid ${task.pid ?? 'unknown'} (${formatRunTime(task.runMs)})`
    )
    .join(', ');
  return long.length === 1 ? `worker ${workers}` : `workers ${workers}`;
}

function alertBody(
  state: LaneState,
  long: RunningTask[],
  processName: string
): string {
  const what =
    long.length === 1
      ? `${state.one} has held a worker past ${state.limit}.`
      : `${long.length} ${state.many} have each held a worker past ${state.limit}.`;
  const where = `Process ${processName}, ${describeWorkers(long)}.`;
  return `${what} ${where} ${listCommand(long)} ${state.hint} ${HOW_TO_FREE}`;
}

// Settles with the send, or rejects once the provider has gone the limit
// without answering. A send that then succeeds after all is reported through
// onLateSuccess, so an email that did go out is not sent a second time.
function withTimeout(
  send: Promise<void>,
  ms: number,
  onLateSuccess: () => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`no answer from the mail provider in ${ms}ms`));
    }, ms);
    send.then(
      () => {
        clearTimeout(timer);
        if (timedOut) onLateSuccess();
        else resolve();
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function createConversionLongTaskWatch(
  deps: ConversionLongTaskWatchDeps
) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.warn(line));
  const processName = deps.processName ?? 'server (not under pm2)';
  let ticking = false;
  const lanes: LaneState[] = [
    {
      lane: 'upload',
      one: 'An upload conversion',
      many: 'upload conversions',
      limit: '30 minutes',
      hint: TOOL_HINT,
      thresholdMs: LONG_UPLOAD_TASK_THRESHOLD_MS,
      read: (sample) => sample.uploadRuns,
      alertedCount: 0,
      lastAlertAt: null,
      failedSends: 0,
      retryAt: 0,
    },
    {
      lane: 'background',
      one: 'A Notion conversion',
      many: 'Notion conversions',
      limit: '4 hours',
      hint: NOTION_HINT,
      thresholdMs: LONG_BACKGROUND_TASK_THRESHOLD_MS,
      read: (sample) => sample.backgroundRuns,
      alertedCount: 0,
      lastAlertAt: null,
      failedSends: 0,
      retryAt: 0,
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
      }
      state.lastAlertAt = null;
      state.alertedCount = 0;
      state.failedSends = 0;
      state.retryAt = 0;
      return;
    }
    // One more long task than last reported is news at once; the same ones
    // still running are only a reminder.
    state.alertedCount = Math.min(state.alertedCount, long.length);
    const isNewTask = long.length > state.alertedCount;
    const reminderDue =
      state.lastAlertAt != null &&
      at - state.lastAlertAt >= LONG_TASK_ALERT_COOLDOWN_MS;
    if (!isNewTask && !reminderDue) return;
    if (at < state.retryAt) return;
    const longestMs = Math.max(...long.map((task) => task.runMs));
    log(
      `[conversion-pool] long-task lane=${state.lane} tasks=${long.length} longest_min=${toMinutes(longestMs)}`
    );
    const subject = isNewTask
      ? firstAlertSubject(state, long.length)
      : reminderSubject(state, long.length);
    const delivered = () => {
      state.alertedCount = long.length;
      state.lastAlertAt = at;
      state.failedSends = 0;
      state.retryAt = 0;
    };
    try {
      await withTimeout(
        deps.sendAlert(subject, alertBody(state, long, processName)),
        ALERT_SEND_TIMEOUT_MS,
        delivered
      );
      delivered();
    } catch (error) {
      // What was reported stays as it was, so this alert is sent again, after
      // a wait that doubles with each failure up to an hour.
      state.failedSends += 1;
      const wait = Math.min(
        ALERT_RETRY_BASE_MS * 2 ** (state.failedSends - 1),
        ALERT_RETRY_MAX_MS
      );
      state.retryAt = at + wait;
      log(
        `[conversion-pool] long-task alert email failed, next try in ${formatRunTime(wait)}: ${String(error)}`
      );
    }
  };

  // One tick at a time: a send still waiting on the provider when the next
  // minute comes round must not be started a second time.
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const sample = deps.samplePool();
      if (sample == null) return;
      const at = now();
      for (const state of lanes) {
        await checkLane(state, state.read(sample), at);
      }
    } finally {
      ticking = false;
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

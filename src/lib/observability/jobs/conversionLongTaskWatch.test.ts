import { vi } from 'vitest';
import {
  ALERT_RETRY_BASE_MS,
  ALERT_SEND_TIMEOUT_MS,
  LONG_BACKGROUND_TASK_THRESHOLD_MS,
  LONG_TASK_ALERT_COOLDOWN_MS,
  LONG_TASK_WATCH_INTERVAL_MS,
  LONG_UPLOAD_TASK_THRESHOLD_MS,
  createConversionLongTaskWatch,
  formatRunTime,
  scheduleConversionLongTaskWatch,
} from './conversionLongTaskWatch';

interface RunningTask {
  pid: number | null;
  runMs: number;
}

interface Sample {
  uploadRuns: RunningTask[];
  backgroundRuns: RunningTask[];
}

function setup(initial: Sample | null, underPm2 = true) {
  let sample = initial;
  let clock = 0;
  const logs: string[] = [];
  const sendAlert = vi.fn().mockResolvedValue(undefined);
  const watch = createConversionLongTaskWatch({
    samplePool: () => sample,
    now: () => clock,
    log: (line) => logs.push(line),
    sendAlert,
    processName: underPm2 ? 'server-blue' : undefined,
  });
  return {
    watch,
    logs,
    sendAlert,
    setSample: (next: Sample | null) => {
      sample = next;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const MINUTE = 60_000;
const HUNG = LONG_UPLOAD_TASK_THRESHOLD_MS + MINUTE;

const run = (pid: number | null, runMs: number): RunningTask => ({
  pid,
  runMs,
});

const idle: Sample = { uploadRuns: [], backgroundRuns: [] };

const oneHungUpload: Sample = {
  uploadRuns: [run(101, 2 * MINUTE), run(102, HUNG)],
  backgroundRuns: [],
};

const twoHungUploads: Sample = {
  uploadRuns: [run(102, HUNG), run(103, HUNG)],
  backgroundRuns: [],
};

const FIRST_UPLOAD_LINE =
  '[conversion-pool] long-task lane=upload tasks=1 longest_min=31';

describe('conversion long task watch', () => {
  it('stays quiet while every task is under its threshold', async () => {
    const ctx = setup({
      uploadRuns: [run(101, LONG_UPLOAD_TASK_THRESHOLD_MS - 1)],
      backgroundRuns: [run(201, LONG_BACKGROUND_TASK_THRESHOLD_MS - 1)],
    });
    await ctx.watch.tick();

    expect(ctx.sendAlert).not.toHaveBeenCalled();
    expect(ctx.logs).toEqual([]);
  });

  it('logs and emails once an upload task has run past its threshold', async () => {
    const ctx = setup(oneHungUpload);
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([FIRST_UPLOAD_LINE]);
    expect(ctx.sendAlert).toHaveBeenCalledTimes(1);
    expect(ctx.sendAlert.mock.calls[0][0]).toBe(
      '[2anki] An upload conversion has run past 30 minutes'
    );
  });

  it('says which process and which worker to look at, for how long, and how', async () => {
    const ctx = setup(oneHungUpload);
    await ctx.watch.tick();

    expect(ctx.sendAlert.mock.calls[0][1]).toBe(
      'An upload conversion has held a worker past 30 minutes. ' +
        'Process server-blue, worker pid 102 (31 min). ' +
        'A pdfimages, pdftoppm, pdfinfo, or soffice process that has run this long is hung. ' +
        'Nothing was stopped. Killing a hung subprocess fails that conversion and frees its worker; ' +
        'restarting the server process frees them all, and the next deploy does that too. ' +
        'To list its subprocesses on the server: ps --ppid 102 -o pid,etime,cmd'
    );
  });

  it('says so when the server is not running under pm2', async () => {
    const ctx = setup(oneHungUpload, false);
    await ctx.watch.tick();

    expect(ctx.sendAlert.mock.calls[0][1]).toContain(
      'Process server (not under pm2), worker pid 102 (31 min).'
    );
  });

  it('names a worker whose pid is not known yet', async () => {
    const ctx = setup({ uploadRuns: [run(null, HUNG)], backgroundRuns: [] });
    await ctx.watch.tick();

    expect(ctx.sendAlert.mock.calls[0][1]).toMatch(
      /worker pid unknown \(31 min\)\..* To list its subprocesses on the server: ps --ppid <worker pid> -o pid,etime,cmd$/
    );
  });

  it('leaves a long Notion conversion alone until the background threshold', async () => {
    const ctx = setup({
      uploadRuns: [],
      backgroundRuns: [run(201, LONG_UPLOAD_TASK_THRESHOLD_MS * 4)],
    });
    await ctx.watch.tick();
    expect(ctx.sendAlert).not.toHaveBeenCalled();

    ctx.setSample({
      uploadRuns: [],
      backgroundRuns: [run(201, LONG_BACKGROUND_TASK_THRESHOLD_MS + MINUTE)],
    });
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([
      '[conversion-pool] long-task lane=background tasks=1 longest_min=241',
    ]);
    expect(ctx.sendAlert.mock.calls[0][0]).toBe(
      '[2anki] A Notion conversion has run past 4 hours'
    );
    expect(ctx.sendAlert.mock.calls[0][1]).toContain(
      'Process server-blue, worker pid 201 (4 h 1 min). '
    );
    expect(ctx.sendAlert.mock.calls[0][1]).toContain(
      'A Notion conversion can also hang on a network call, with no subprocess to find.'
    );
  });

  it('alerts each lane on its own when both hold a long task', async () => {
    const ctx = setup({
      uploadRuns: [run(102, LONG_UPLOAD_TASK_THRESHOLD_MS)],
      backgroundRuns: [run(201, LONG_BACKGROUND_TASK_THRESHOLD_MS)],
    });
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([
      '[conversion-pool] long-task lane=upload tasks=1 longest_min=30',
      '[conversion-pool] long-task lane=background tasks=1 longest_min=240',
    ]);
    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('stays silent within the cooldown while the same task keeps running', async () => {
    const ctx = setup(oneHungUpload);
    await ctx.watch.tick();
    ctx.advance(LONG_TASK_ALERT_COOLDOWN_MS - 1);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(1);
    expect(ctx.logs).toHaveLength(1);
  });

  it("sends a reminder with 'still running' in the subject once the cooldown has passed", async () => {
    const ctx = setup(oneHungUpload);
    await ctx.watch.tick();
    ctx.advance(LONG_TASK_ALERT_COOLDOWN_MS);
    ctx.setSample({
      uploadRuns: [run(102, HUNG + LONG_TASK_ALERT_COOLDOWN_MS)],
      backgroundRuns: [],
    });
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
    expect(ctx.sendAlert.mock.calls[1][0]).toBe(
      '[2anki] An upload conversion is still running past 30 minutes'
    );
    expect(ctx.sendAlert.mock.calls[1][1]).toContain(
      'worker pid 102 (6 h 31 min).'
    );
  });

  it('words the reminder for several tasks in the plural', async () => {
    const ctx = setup(twoHungUploads);
    await ctx.watch.tick();
    ctx.advance(LONG_TASK_ALERT_COOLDOWN_MS);
    await ctx.watch.tick();

    expect(ctx.sendAlert.mock.calls[1][0]).toBe(
      '[2anki] 2 upload conversions are still running past 30 minutes'
    );
  });

  it('emails at once when a second task joins the first past the threshold', async () => {
    const ctx = setup(oneHungUpload);
    await ctx.watch.tick();
    ctx.advance(3 * MINUTE);
    ctx.setSample({
      uploadRuns: [run(102, HUNG + 3 * MINUTE), run(103, HUNG)],
      backgroundRuns: [],
    });
    await ctx.watch.tick();

    expect(ctx.logs[1]).toBe(
      '[conversion-pool] long-task lane=upload tasks=2 longest_min=34'
    );
    expect(ctx.sendAlert.mock.calls[1][0]).toBe(
      '[2anki] 2 upload conversions have run past 30 minutes'
    );
    expect(ctx.sendAlert.mock.calls[1][1]).toMatch(
      /^2 upload conversions have each held a worker past 30 minutes\. Process server-blue, workers pid 102 \(34 min\), pid 103 \(31 min\)\..* To list their subprocesses on the server: ps --ppid 102,103 -o pid,etime,cmd$/
    );
  });

  it('says nothing when one of two long tasks ends, and reports a later one', async () => {
    const ctx = setup(twoHungUploads);
    await ctx.watch.tick();
    ctx.advance(MINUTE);
    ctx.setSample(oneHungUpload);
    await ctx.watch.tick();
    expect(ctx.sendAlert).toHaveBeenCalledTimes(1);
    expect(ctx.logs).toHaveLength(1);

    ctx.advance(MINUTE);
    ctx.setSample(twoHungUploads);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('logs once when the last long task ends, and alerts afresh for the next one', async () => {
    const ctx = setup(oneHungUpload);
    await ctx.watch.tick();
    ctx.setSample(idle);
    await ctx.watch.tick();
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([
      FIRST_UPLOAD_LINE,
      '[conversion-pool] long-task cleared lane=upload',
    ]);

    ctx.advance(MINUTE);
    ctx.setSample(oneHungUpload);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('sends the alert again a minute after the email failed, as a first alert', async () => {
    const ctx = setup(oneHungUpload);
    ctx.sendAlert.mockRejectedValueOnce(new Error('sendgrid down'));
    await ctx.watch.tick();
    expect(ctx.logs[1]).toBe(
      '[conversion-pool] long-task alert email failed, next try in 1 min: Error: sendgrid down'
    );

    ctx.advance(ALERT_RETRY_BASE_MS);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
    expect(ctx.sendAlert.mock.calls[1][0]).toBe(
      '[2anki] An upload conversion has run past 30 minutes'
    );

    ctx.advance(MINUTE);
    await ctx.watch.tick();
    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('waits twice as long after each failed send while the provider stays down', async () => {
    const ctx = setup(oneHungUpload);
    ctx.sendAlert.mockRejectedValue(new Error('sendgrid down'));

    for (let minute = 0; minute < 4 * 60; minute += 1) {
      await ctx.watch.tick();
      ctx.advance(MINUTE);
    }

    expect(ctx.sendAlert).toHaveBeenCalledTimes(9);
    expect(
      ctx.logs.filter((line) => line.includes('alert email failed'))
    ).toEqual([
      '[conversion-pool] long-task alert email failed, next try in 1 min: Error: sendgrid down',
      '[conversion-pool] long-task alert email failed, next try in 2 min: Error: sendgrid down',
      '[conversion-pool] long-task alert email failed, next try in 4 min: Error: sendgrid down',
      '[conversion-pool] long-task alert email failed, next try in 8 min: Error: sendgrid down',
      '[conversion-pool] long-task alert email failed, next try in 16 min: Error: sendgrid down',
      '[conversion-pool] long-task alert email failed, next try in 32 min: Error: sendgrid down',
      '[conversion-pool] long-task alert email failed, next try in 1 h: Error: sendgrid down',
      '[conversion-pool] long-task alert email failed, next try in 1 h: Error: sendgrid down',
      '[conversion-pool] long-task alert email failed, next try in 1 h: Error: sendgrid down',
    ]);
  });

  it('retries a failed reminder as a reminder', async () => {
    const ctx = setup(oneHungUpload);
    await ctx.watch.tick();
    ctx.advance(LONG_TASK_ALERT_COOLDOWN_MS);
    ctx.sendAlert.mockRejectedValueOnce(new Error('sendgrid down'));
    await ctx.watch.tick();
    ctx.advance(ALERT_RETRY_BASE_MS);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(3);
    expect(ctx.sendAlert.mock.calls[2][0]).toBe(
      '[2anki] An upload conversion is still running past 30 minutes'
    );
  });

  it('still checks the other lane when one alert email fails', async () => {
    const ctx = setup({
      uploadRuns: [run(102, HUNG)],
      backgroundRuns: [run(201, LONG_BACKGROUND_TASK_THRESHOLD_MS)],
    });
    ctx.sendAlert.mockRejectedValueOnce(new Error('sendgrid down'));
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([
      FIRST_UPLOAD_LINE,
      '[conversion-pool] long-task alert email failed, next try in 1 min: Error: sendgrid down',
      '[conversion-pool] long-task lane=background tasks=1 longest_min=240',
    ]);
    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('starts no second send while the first is still waiting on the provider', async () => {
    vi.useFakeTimers();
    try {
      const ctx = setup(oneHungUpload);
      ctx.sendAlert.mockReturnValue(new Promise(() => undefined));

      const first = ctx.watch.tick();
      await ctx.watch.tick();
      await ctx.watch.tick();
      expect(ctx.sendAlert).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(ALERT_SEND_TIMEOUT_MS);
      await first;

      expect(ctx.logs[1]).toBe(
        '[conversion-pool] long-task alert email failed, next try in 1 min: Error: no answer from the mail provider in 30000ms'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts a send that succeeds after the time limit as delivered, and does not send it again', async () => {
    vi.useFakeTimers();
    try {
      const ctx = setup(oneHungUpload);
      let finish: () => void = () => undefined;
      ctx.sendAlert.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        })
      );

      const first = ctx.watch.tick();
      await vi.advanceTimersByTimeAsync(ALERT_SEND_TIMEOUT_MS);
      await first;
      finish();
      await vi.advanceTimersByTimeAsync(0);

      ctx.advance(ALERT_RETRY_BASE_MS);
      await ctx.watch.tick();
      ctx.advance(LONG_TASK_ALERT_COOLDOWN_MS - ALERT_RETRY_BASE_MS - 1);
      await ctx.watch.tick();

      expect(ctx.sendAlert).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a late answer once the long task it reported has ended', async () => {
    vi.useFakeTimers();
    try {
      const ctx = setup(oneHungUpload);
      let finish: () => void = () => undefined;
      ctx.sendAlert.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        })
      );
      const first = ctx.watch.tick();
      await vi.advanceTimersByTimeAsync(ALERT_SEND_TIMEOUT_MS);
      await first;

      ctx.setSample(idle);
      await ctx.watch.tick();
      finish();
      await vi.advanceTimersByTimeAsync(0);
      ctx.setSample(oneHungUpload);
      await ctx.watch.tick();

      expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
      expect(ctx.sendAlert.mock.calls[1][0]).toBe(
        '[2anki] An upload conversion has run past 30 minutes'
      );
      expect(ctx.logs.filter((line) => line.includes('cleared'))).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the newer alert when an older send answers after it', async () => {
    vi.useFakeTimers();
    try {
      const ctx = setup(oneHungUpload);
      let finish: () => void = () => undefined;
      ctx.sendAlert.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        })
      );
      const first = ctx.watch.tick();
      await vi.advanceTimersByTimeAsync(ALERT_SEND_TIMEOUT_MS);
      await first;

      ctx.advance(ALERT_RETRY_BASE_MS);
      ctx.setSample(twoHungUploads);
      await ctx.watch.tick();
      expect(ctx.sendAlert).toHaveBeenCalledTimes(2);

      finish();
      await vi.advanceTimersByTimeAsync(0);
      ctx.advance(MINUTE);
      await ctx.watch.tick();

      expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
      expect(ctx.logs).toContain(
        '[conversion-pool] long-task alert email arrived late lane=upload'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('records an alert answered in time even when the clock has stepped back', async () => {
    const ctx = setup(oneHungUpload);
    ctx.advance(10 * MINUTE);
    await ctx.watch.tick();
    ctx.advance(-9 * MINUTE);
    ctx.setSample(twoHungUploads);
    await ctx.watch.tick();
    ctx.advance(MINUTE);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('alerts at once for a new long task after an alert that never got through', async () => {
    const ctx = setup(oneHungUpload);
    ctx.sendAlert.mockRejectedValueOnce(new Error('sendgrid down'));
    await ctx.watch.tick();
    ctx.setSample(idle);
    await ctx.watch.tick();
    ctx.setSample(oneHungUpload);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
    expect(ctx.logs.filter((line) => line.includes('cleared'))).toEqual([]);
  });

  it('does nothing before the pool exists', async () => {
    const ctx = setup(null);
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([]);
    expect(ctx.sendAlert).not.toHaveBeenCalled();
  });
});

describe('formatRunTime', () => {
  it.each([
    [31 * MINUTE, '31 min'],
    [59 * MINUTE, '59 min'],
    [59.5 * MINUTE, '1 h'],
    [60 * MINUTE, '1 h'],
    [1092 * MINUTE, '18 h 12 min'],
  ])('writes %i ms as %s', (ms, text) => {
    expect(formatRunTime(ms)).toBe(text);
  });
});

describe('scheduleConversionLongTaskWatch', () => {
  it('ticks every minute without holding the process open', () => {
    const unref = vi.fn();
    const setIntervalFn = vi.fn((_tick: () => void, _ms: number) => ({
      unref,
    }));
    scheduleConversionLongTaskWatch({
      samplePool: () => null,
      sendAlert: vi.fn(),
      processName: 'server-blue',
      setIntervalFn,
    });

    expect(setIntervalFn.mock.calls[0][1]).toBe(LONG_TASK_WATCH_INTERVAL_MS);
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('logs a tick that throws instead of letting it reach the process', async () => {
    const logs: string[] = [];
    const setIntervalFn = vi.fn((_tick: () => void, _ms: number) => ({
      unref: vi.fn(),
    }));
    scheduleConversionLongTaskWatch({
      samplePool: () => {
        throw new Error('pool gone');
      },
      sendAlert: vi.fn(),
      processName: 'server-blue',
      log: (line) => logs.push(line),
      setIntervalFn,
    });

    setIntervalFn.mock.calls[0][0]();
    await Promise.resolve();
    await Promise.resolve();

    expect(logs).toEqual([
      '[conversion-pool] long-task watch failed: Error: pool gone',
    ]);
  });
});

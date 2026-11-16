import { vi } from 'vitest';
import {
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

function setup(initial: Sample | null) {
  let sample = initial;
  let clock = 0;
  const logs: string[] = [];
  const sendAlert = vi.fn().mockResolvedValue(undefined);
  const watch = createConversionLongTaskWatch({
    samplePool: () => sample,
    now: () => clock,
    log: (line) => logs.push(line),
    sendAlert,
    processName: 'server-blue',
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

const run = (pid: number, runMs: number): RunningTask => ({ pid, runMs });

const idle: Sample = { uploadRuns: [], backgroundRuns: [] };

const oneHungUpload: Sample = {
  uploadRuns: [run(101, 2 * MINUTE), run(102, HUNG)],
  backgroundRuns: [],
};

const twoHungUploads: Sample = {
  uploadRuns: [run(102, HUNG), run(103, HUNG)],
  backgroundRuns: [],
};

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

    expect(ctx.logs).toEqual([
      '[conversion-pool] long-task lane=upload tasks=1 longest_min=31',
    ]);
    expect(ctx.sendAlert).toHaveBeenCalledTimes(1);
    expect(ctx.sendAlert.mock.calls[0][0]).toBe(
      '[2anki] An upload conversion has run past 30 minutes'
    );
  });

  it('says which process and which worker to look at, and for how long', async () => {
    const ctx = setup(oneHungUpload);
    await ctx.watch.tick();

    expect(ctx.sendAlert.mock.calls[0][1]).toContain(
      'An upload conversion has held a worker for more than 30 minutes. Process server-blue, worker pid 102 (31 minutes). Nothing was stopped.'
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
      'worker pid 201 (4 h 1 min)'
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

  it('sends a reminder that says still once the cooldown has passed', async () => {
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
      'worker pid 102 (6 h 31 min)'
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
    expect(ctx.sendAlert.mock.calls[1][1]).toContain(
      '2 upload conversions have each held a worker for more than 30 minutes. Process server-blue, worker pid 102 (34 minutes), pid 103 (31 minutes).'
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
      '[conversion-pool] long-task lane=upload tasks=1 longest_min=31',
      '[conversion-pool] long-task cleared lane=upload',
    ]);

    ctx.advance(MINUTE);
    ctx.setSample(oneHungUpload);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('sends the alert again on the next tick when the email failed', async () => {
    const ctx = setup(oneHungUpload);
    ctx.sendAlert.mockRejectedValueOnce(new Error('sendgrid down'));
    await ctx.watch.tick();
    expect(ctx.logs[1]).toBe(
      '[conversion-pool] long-task alert email failed: Error: sendgrid down'
    );

    ctx.advance(MINUTE);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
    expect(ctx.sendAlert.mock.calls[1][0]).toBe(
      '[2anki] An upload conversion has run past 30 minutes'
    );

    ctx.advance(MINUTE);
    await ctx.watch.tick();
    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('still checks the other lane when one alert email fails', async () => {
    const ctx = setup({
      uploadRuns: [run(102, HUNG)],
      backgroundRuns: [run(201, LONG_BACKGROUND_TASK_THRESHOLD_MS)],
    });
    ctx.sendAlert.mockRejectedValueOnce(new Error('sendgrid down'));
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([
      '[conversion-pool] long-task lane=upload tasks=1 longest_min=31',
      '[conversion-pool] long-task alert email failed: Error: sendgrid down',
      '[conversion-pool] long-task lane=background tasks=1 longest_min=240',
    ]);
    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
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
    [31 * MINUTE, '31 minutes'],
    [59 * MINUTE, '59 minutes'],
    [60 * MINUTE, '1 h 0 min'],
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

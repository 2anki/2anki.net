import { vi } from 'vitest';
import {
  LONG_BACKGROUND_TASK_THRESHOLD_MS,
  LONG_TASK_ALERT_COOLDOWN_MS,
  LONG_TASK_WATCH_INTERVAL_MS,
  LONG_UPLOAD_TASK_THRESHOLD_MS,
  createConversionLongTaskWatch,
  scheduleConversionLongTaskWatch,
} from './conversionLongTaskWatch';

interface Sample {
  uploadRunsMs: number[];
  backgroundRunsMs: number[];
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

const idle: Sample = { uploadRunsMs: [], backgroundRunsMs: [] };

const oneHungUpload: Sample = {
  uploadRunsMs: [2 * MINUTE, HUNG],
  backgroundRunsMs: [],
};

describe('conversion long task watch', () => {
  it('stays quiet while every task is under its threshold', async () => {
    const ctx = setup({
      uploadRunsMs: [LONG_UPLOAD_TASK_THRESHOLD_MS - 1],
      backgroundRunsMs: [LONG_BACKGROUND_TASK_THRESHOLD_MS - 1],
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
    expect(ctx.sendAlert.mock.calls[0][1]).toContain(
      'An upload conversion has held a worker for 31 minutes. Nothing was stopped.'
    );
  });

  it('leaves a long Notion conversion alone until the background threshold', async () => {
    const ctx = setup({
      uploadRunsMs: [],
      backgroundRunsMs: [LONG_UPLOAD_TASK_THRESHOLD_MS * 4],
    });
    await ctx.watch.tick();
    expect(ctx.sendAlert).not.toHaveBeenCalled();

    ctx.setSample({
      uploadRunsMs: [],
      backgroundRunsMs: [LONG_BACKGROUND_TASK_THRESHOLD_MS],
    });
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([
      '[conversion-pool] long-task lane=background tasks=1 longest_min=240',
    ]);
    expect(ctx.sendAlert.mock.calls[0][0]).toBe(
      '[2anki] A Notion conversion has run past 4 hours'
    );
  });

  it('alerts each lane on its own when both hold a long task', async () => {
    const ctx = setup({
      uploadRunsMs: [LONG_UPLOAD_TASK_THRESHOLD_MS],
      backgroundRunsMs: [LONG_BACKGROUND_TASK_THRESHOLD_MS],
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

  it('emails a reminder once the cooldown has passed', async () => {
    const ctx = setup(oneHungUpload);
    await ctx.watch.tick();
    ctx.advance(LONG_TASK_ALERT_COOLDOWN_MS);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('emails at once when a second task joins the first past the threshold', async () => {
    const ctx = setup(oneHungUpload);
    await ctx.watch.tick();
    ctx.advance(3 * MINUTE);
    ctx.setSample({
      uploadRunsMs: [HUNG, HUNG + 3 * MINUTE],
      backgroundRunsMs: [],
    });
    await ctx.watch.tick();

    expect(ctx.logs[1]).toBe(
      '[conversion-pool] long-task lane=upload tasks=2 longest_min=34'
    );
    expect(ctx.sendAlert.mock.calls[1][0]).toBe(
      '[2anki] 2 upload conversions have run past 30 minutes'
    );
    expect(ctx.sendAlert.mock.calls[1][1]).toContain(
      '2 upload conversions have each held a worker for more than 30 minutes, the longest for 34 minutes.'
    );
  });

  it('says nothing when one of two long tasks ends, and reports a later one', async () => {
    const ctx = setup({ uploadRunsMs: [HUNG, HUNG], backgroundRunsMs: [] });
    await ctx.watch.tick();
    ctx.advance(MINUTE);
    ctx.setSample(oneHungUpload);
    await ctx.watch.tick();
    expect(ctx.sendAlert).toHaveBeenCalledTimes(1);
    expect(ctx.logs).toHaveLength(1);

    ctx.advance(MINUTE);
    ctx.setSample({ uploadRunsMs: [HUNG, HUNG], backgroundRunsMs: [] });
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

  it('logs a failed alert email and still checks the other lane', async () => {
    const ctx = setup({
      uploadRunsMs: [HUNG],
      backgroundRunsMs: [LONG_BACKGROUND_TASK_THRESHOLD_MS],
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

describe('scheduleConversionLongTaskWatch', () => {
  it('ticks every minute without holding the process open', () => {
    const unref = vi.fn();
    const setIntervalFn = vi.fn((_tick: () => void, _ms: number) => ({
      unref,
    }));
    scheduleConversionLongTaskWatch({
      samplePool: () => null,
      sendAlert: vi.fn(),
      setIntervalFn,
    });

    expect(setIntervalFn.mock.calls[0][1]).toBe(LONG_TASK_WATCH_INTERVAL_MS);
    expect(unref).toHaveBeenCalledTimes(1);
  });
});

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
  longestUploadRunMs: number;
  longestBackgroundRunMs: number;
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

const idle: Sample = { longestUploadRunMs: 0, longestBackgroundRunMs: 0 };

const hungUpload: Sample = {
  longestUploadRunMs: LONG_UPLOAD_TASK_THRESHOLD_MS + 60_000,
  longestBackgroundRunMs: 0,
};

describe('conversion long task watch', () => {
  it('stays quiet while every task is under its threshold', async () => {
    const ctx = setup({
      longestUploadRunMs: LONG_UPLOAD_TASK_THRESHOLD_MS - 1,
      longestBackgroundRunMs: LONG_BACKGROUND_TASK_THRESHOLD_MS - 1,
    });
    await ctx.watch.tick();

    expect(ctx.sendAlert).not.toHaveBeenCalled();
    expect(ctx.logs).toEqual([]);
  });

  it('logs and emails once an upload task has run past its threshold', async () => {
    const ctx = setup(hungUpload);
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([
      '[conversion-pool] long-task lane=upload running_min=31',
    ]);
    expect(ctx.sendAlert).toHaveBeenCalledTimes(1);
    expect(ctx.sendAlert.mock.calls[0][0]).toBe(
      '[2anki] A conversion has been running for 31 minutes'
    );
    expect(ctx.sendAlert.mock.calls[0][1]).toContain('upload conversion');
  });

  it('leaves a long Notion conversion alone until the background threshold', async () => {
    const ctx = setup({
      longestUploadRunMs: 0,
      longestBackgroundRunMs: LONG_UPLOAD_TASK_THRESHOLD_MS * 4,
    });
    await ctx.watch.tick();
    expect(ctx.sendAlert).not.toHaveBeenCalled();

    ctx.setSample({
      longestUploadRunMs: 0,
      longestBackgroundRunMs: LONG_BACKGROUND_TASK_THRESHOLD_MS,
    });
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([
      '[conversion-pool] long-task lane=background running_min=240',
    ]);
    expect(ctx.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('alerts each lane on its own when both hold a long task', async () => {
    const ctx = setup({
      longestUploadRunMs: LONG_UPLOAD_TASK_THRESHOLD_MS,
      longestBackgroundRunMs: LONG_BACKGROUND_TASK_THRESHOLD_MS,
    });
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([
      '[conversion-pool] long-task lane=upload running_min=30',
      '[conversion-pool] long-task lane=background running_min=240',
    ]);
    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('stays silent within the cooldown while the task keeps running', async () => {
    const ctx = setup(hungUpload);
    await ctx.watch.tick();
    ctx.advance(LONG_TASK_ALERT_COOLDOWN_MS - 1);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(1);
    expect(ctx.logs).toHaveLength(1);
  });

  it('emails again once the cooldown has passed', async () => {
    const ctx = setup(hungUpload);
    await ctx.watch.tick();
    ctx.advance(LONG_TASK_ALERT_COOLDOWN_MS);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('logs once when the long task ends, and alerts afresh for the next one', async () => {
    const ctx = setup(hungUpload);
    await ctx.watch.tick();
    ctx.setSample(idle);
    await ctx.watch.tick();
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([
      '[conversion-pool] long-task lane=upload running_min=31',
      '[conversion-pool] long-task cleared lane=upload',
    ]);

    ctx.advance(60_000);
    ctx.setSample(hungUpload);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('keeps watching when the alert email fails', async () => {
    const ctx = setup(hungUpload);
    ctx.sendAlert.mockRejectedValueOnce(new Error('sendgrid down'));
    await ctx.watch.tick();

    expect(ctx.logs[1]).toBe(
      '[conversion-pool] long-task alert email failed: Error: sendgrid down'
    );
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

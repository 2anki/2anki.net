import { vi } from 'vitest';
import {
  CONVERSION_STALL_ALERT_COOLDOWN_MS,
  CONVERSION_STALL_THRESHOLD_MS,
  CONVERSION_STALL_WATCH_INTERVAL_MS,
  createConversionStallWatch,
  scheduleConversionStallWatch,
} from './conversionStallWatch';

interface Sample {
  queueSize: number;
  busyBackground: number;
  oldestInteractiveWaitMs: number;
}

function setup(initial: Sample | null) {
  let sample = initial;
  let clock = 0;
  const logs: string[] = [];
  const sendAlert = vi.fn().mockResolvedValue(undefined);
  const recordAlert = vi.fn();
  const watch = createConversionStallWatch({
    samplePool: () => sample,
    now: () => clock,
    log: (line) => logs.push(line),
    sendAlert,
    recordAlert,
  });
  return {
    watch,
    logs,
    sendAlert,
    recordAlert,
    setSample: (next: Sample | null) => {
      sample = next;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const stalled: Sample = {
  queueSize: 12,
  busyBackground: 3,
  oldestInteractiveWaitMs: CONVERSION_STALL_THRESHOLD_MS + 30_000,
};

const healthy: Sample = {
  queueSize: 0,
  busyBackground: 1,
  oldestInteractiveWaitMs: 0,
};

describe('conversion stall watch', () => {
  it('stays quiet while queued uploads wait under the threshold', async () => {
    const ctx = setup({
      ...healthy,
      queueSize: 2,
      oldestInteractiveWaitMs: CONVERSION_STALL_THRESHOLD_MS - 1,
    });
    await ctx.watch.tick();

    expect(ctx.sendAlert).not.toHaveBeenCalled();
    expect(ctx.logs).toEqual([]);
  });

  it('logs and emails once when an upload has waited past the threshold', async () => {
    const ctx = setup(stalled);
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([
      '[conversion-pool] stall oldest_wait_s=150 queue=12 busy_background=3',
    ]);
    expect(ctx.sendAlert).toHaveBeenCalledTimes(1);
    expect(ctx.sendAlert.mock.calls[0][0]).toBe(
      '[2anki] Uploads waiting 150s in the conversion queue'
    );
    expect(ctx.recordAlert).toHaveBeenCalledTimes(1);
  });

  it('does not email again within the cooldown while the stall persists', async () => {
    const ctx = setup(stalled);
    await ctx.watch.tick();
    ctx.advance(CONVERSION_STALL_ALERT_COOLDOWN_MS - 1);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(1);
    expect(ctx.logs).toHaveLength(2);
  });

  it('emails again once the cooldown has passed', async () => {
    const ctx = setup(stalled);
    await ctx.watch.tick();
    ctx.advance(CONVERSION_STALL_ALERT_COOLDOWN_MS);
    await ctx.watch.tick();

    expect(ctx.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('logs when the stall clears', async () => {
    const ctx = setup(stalled);
    await ctx.watch.tick();
    ctx.advance(240_000);
    ctx.setSample(healthy);
    await ctx.watch.tick();
    await ctx.watch.tick();

    expect(ctx.logs[1]).toBe('[conversion-pool] stall cleared after 240s');
    expect(ctx.logs).toHaveLength(2);
  });

  it('keeps watching when the alert email fails', async () => {
    const ctx = setup(stalled);
    ctx.sendAlert.mockRejectedValueOnce(new Error('sendgrid down'));
    await ctx.watch.tick();

    expect(ctx.logs[0]).toContain('[conversion-pool] stall');
    expect(ctx.logs[1]).toContain('stall alert email failed');
  });

  it('does nothing before the pool exists', async () => {
    const ctx = setup(null);
    await ctx.watch.tick();

    expect(ctx.logs).toEqual([]);
    expect(ctx.sendAlert).not.toHaveBeenCalled();
  });
});

describe('scheduleConversionStallWatch', () => {
  it('ticks every minute without holding the process open', () => {
    const unref = vi.fn();
    const setIntervalFn = vi.fn(() => ({ unref }));
    scheduleConversionStallWatch({
      samplePool: () => null,
      sendAlert: vi.fn(),
      recordAlert: vi.fn(),
      setIntervalFn,
    });

    expect(setIntervalFn).toHaveBeenCalledWith(
      expect.any(Function),
      CONVERSION_STALL_WATCH_INTERVAL_MS
    );
    expect(unref).toHaveBeenCalledTimes(1);
  });
});

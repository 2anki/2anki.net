import { vi } from 'vitest';
import { IEventsRepository } from '../../data_layer/EventsRepository';
import { CancelFunnelService } from './CancelFunnelService';

const buildRepo = (counts: Record<string, number>): IEventsRepository => {
  const countByName = vi.fn((name: string) =>
    Promise.resolve(counts[name] ?? 0)
  );
  return { countByName } as unknown as IEventsRepository;
};

const SINCE = new Date('2026-07-01T00:00:00.000Z');

describe('CancelFunnelService', () => {
  it('maps each event name to its stage count', async () => {
    const repo = buildRepo({
      subscription_cancel_started: 100,
      subscription_pause_offered: 40,
      subscription_paused: 12,
      subscription_cancelled: 70,
      subscription_pause_offer_declined: 25,
    });
    const service = new CancelFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(SINCE);

    expect(result.stages).toEqual({
      cancel_started: 100,
      pause_offered: 40,
      paused: 12,
      cancelled: 70,
      pause_offer_declined: 25,
    });
  });

  it('computes save-rate as paused over pause_offered', async () => {
    const repo = buildRepo({
      subscription_cancel_started: 100,
      subscription_pause_offered: 40,
      subscription_paused: 12,
      subscription_cancelled: 70,
    });
    const service = new CancelFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(SINCE);

    expect(result.save_rate_pct).toBe(30);
  });

  it('computes offer-reach as pause_offered over cancel_started', async () => {
    const repo = buildRepo({
      subscription_cancel_started: 200,
      subscription_pause_offered: 50,
      subscription_paused: 10,
      subscription_cancelled: 100,
    });
    const service = new CancelFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(SINCE);

    expect(result.offer_reach_pct).toBe(25);
  });

  it('returns zero rates instead of dividing by zero when denominators are empty', async () => {
    const repo = buildRepo({});
    const service = new CancelFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(SINCE);

    expect(result.save_rate_pct).toBe(0);
    expect(result.offer_reach_pct).toBe(0);
    expect(result.stages).toEqual({
      cancel_started: 0,
      pause_offered: 0,
      paused: 0,
      cancelled: 0,
      pause_offer_declined: 0,
    });
  });

  it('queries every stage against the provided since date', async () => {
    const repo = buildRepo({});
    const service = new CancelFunnelService({ eventsRepo: repo });

    await service.getMetrics(SINCE);

    expect(repo.countByName).toHaveBeenCalledWith(
      'subscription_cancel_started',
      SINCE
    );
    expect(repo.countByName).toHaveBeenCalledWith(
      'subscription_pause_offered',
      SINCE
    );
    expect(repo.countByName).toHaveBeenCalledWith('subscription_paused', SINCE);
    expect(repo.countByName).toHaveBeenCalledWith(
      'subscription_cancelled',
      SINCE
    );
    expect(repo.countByName).toHaveBeenCalledWith(
      'subscription_pause_offer_declined',
      SINCE
    );
  });

  it('returns a null stages payload with an error message when the repository fails', async () => {
    const countByName = vi
      .fn()
      .mockRejectedValue(new Error('connection reset'));
    const repo = { countByName } as unknown as IEventsRepository;
    const service = new CancelFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(SINCE);

    expect(result.stages).toBeNull();
    expect(result.save_rate_pct).toBe(0);
    expect(result.offer_reach_pct).toBe(0);
    expect(result.error).toBe('connection reset');
  });
});

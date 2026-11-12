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
      subscription_cancelled: 70,
    });
    const service = new CancelFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(SINCE);

    expect(result.stages).toEqual({
      cancel_started: 100,
      cancelled: 70,
    });
  });

  it('returns zero counts when nothing was recorded', async () => {
    const repo = buildRepo({});
    const service = new CancelFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(SINCE);

    expect(result.stages).toEqual({ cancel_started: 0, cancelled: 0 });
  });

  it('queries only the cancel stages against the provided since date', async () => {
    const repo = buildRepo({});
    const service = new CancelFunnelService({ eventsRepo: repo });

    await service.getMetrics(SINCE);

    expect(vi.mocked(repo.countByName).mock.calls).toEqual([
      ['subscription_cancel_started', SINCE],
      ['subscription_cancelled', SINCE],
    ]);
  });

  it('returns a null stages payload with an error message when the repository fails', async () => {
    const countByName = vi
      .fn()
      .mockRejectedValue(new Error('connection reset'));
    const repo = { countByName } as unknown as IEventsRepository;
    const service = new CancelFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(SINCE);

    expect(result).toEqual({
      stages: null,
      since: SINCE.toISOString(),
      as_of: expect.any(String),
      error: 'connection reset',
    });
  });
});

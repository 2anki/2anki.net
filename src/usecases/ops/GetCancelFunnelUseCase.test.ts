import { vi, type Mock } from 'vitest';
import { GetCancelFunnelUseCase } from './GetCancelFunnelUseCase';
import {
  CancelFunnelResponse,
  CancelFunnelService,
} from '../../services/ops/CancelFunnelService';

const buildService = () => {
  const getMetrics = vi.fn().mockResolvedValue({
    stages: null,
    save_rate_pct: 0,
    offer_reach_pct: 0,
    since: '',
    as_of: '',
  } as CancelFunnelResponse);
  return {
    service: { getMetrics } as unknown as CancelFunnelService,
    getMetrics,
  };
};

const daysAgo = (call: Mock): number => {
  const since = call.mock.calls[0][0] as Date;
  return Math.round((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000));
};

describe('GetCancelFunnelUseCase', () => {
  it('defaults to a 30-day window when none is provided', async () => {
    const { service, getMetrics } = buildService();

    await new GetCancelFunnelUseCase(service).execute(undefined);

    expect(daysAgo(getMetrics)).toBe(30);
  });

  it('honours a recognised window', async () => {
    const { service, getMetrics } = buildService();

    await new GetCancelFunnelUseCase(service).execute('7d');

    expect(daysAgo(getMetrics)).toBe(7);
  });

  it('falls back to the default window for an unrecognised value', async () => {
    const { service, getMetrics } = buildService();

    await new GetCancelFunnelUseCase(service).execute('nonsense');

    expect(daysAgo(getMetrics)).toBe(30);
  });
});

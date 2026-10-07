import { vi, type Mock } from 'vitest';
import { LandingPageYieldService } from '../../services/ops/LandingPageYieldService';
import { GetLandingPageYieldUseCase } from './GetLandingPageYieldUseCase';

describe('GetLandingPageYieldUseCase', () => {
  const buildUseCase = () => {
    const getMetrics = vi.fn().mockResolvedValue({
      pages: [],
      since: '',
      as_of: '',
    });
    const service = { getMetrics } as unknown as LandingPageYieldService;
    return { useCase: new GetLandingPageYieldUseCase(service), getMetrics };
  };

  const sinceArg = (getMetrics: Mock): Date =>
    getMetrics.mock.calls[0][0] as Date;

  it('defaults to a 30-day window when none is given', async () => {
    const { useCase, getMetrics } = buildUseCase();
    const before = Date.now();

    await useCase.execute(undefined);

    const since = sinceArg(getMetrics);
    const days = (before - since.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(30);
  });

  it('honours a valid window', async () => {
    const { useCase, getMetrics } = buildUseCase();
    const before = Date.now();

    await useCase.execute('7d');

    const since = sinceArg(getMetrics);
    const days = (before - since.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(7);
  });

  it('falls back to 30 days for an unknown window', async () => {
    const { useCase, getMetrics } = buildUseCase();
    const before = Date.now();

    await useCase.execute('999d');

    const since = sinceArg(getMetrics);
    const days = (before - since.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(30);
  });
});

import { vi } from 'vitest';
import { GetPassUnlockMonitorUseCase } from './GetPassUnlockMonitorUseCase';
import type { PassUnlockMonitorService } from '../../services/ops/PassUnlockMonitorService';

const SECONDS_PER_DAY = 24 * 60 * 60;

const buildUseCase = () => {
  const getStatus = vi.fn().mockResolvedValue({
    window_since: '',
    as_of: '',
    grace_minutes: 15,
    checked: 0,
    granted: 0,
    missing: 0,
    pending: 0,
    missingPayments: [],
  });
  const service = { getStatus } as unknown as PassUnlockMonitorService;
  return { useCase: new GetPassUnlockMonitorUseCase(service), getStatus };
};

const daysBetween = (since: Date, now: Date) =>
  Math.round((now.getTime() - since.getTime()) / (SECONDS_PER_DAY * 1000));

describe('GetPassUnlockMonitorUseCase', () => {
  it('defaults to a 7-day window', async () => {
    const { useCase, getStatus } = buildUseCase();

    await useCase.execute(undefined);

    const [since, now] = getStatus.mock.calls[0];
    expect(daysBetween(since, now)).toBe(7);
  });

  it('honours a valid window', async () => {
    const { useCase, getStatus } = buildUseCase();

    await useCase.execute('30d');

    const [since, now] = getStatus.mock.calls[0];
    expect(daysBetween(since, now)).toBe(30);
  });

  it('falls back to the default for an unknown window', async () => {
    const { useCase, getStatus } = buildUseCase();

    await useCase.execute('all-time');

    const [since, now] = getStatus.mock.calls[0];
    expect(daysBetween(since, now)).toBe(7);
  });
});

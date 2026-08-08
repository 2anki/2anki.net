import { GetPaidValueMonitorUseCase } from './GetPaidValueMonitorUseCase';
import type { PaidValueMonitorService } from '../../services/ops/PaidValueMonitorService';

const SECONDS_PER_DAY = 24 * 60 * 60;

const buildUseCase = () => {
  const getStatus = jest.fn().mockResolvedValue({
    window_since: '',
    as_of: '',
    passes: {
      checked: 0,
      withValue: 0,
      zeroValueTried: 0,
      zeroValueNeverTried: 0,
      rows: [],
    },
    claimedAnonymousPasses: {
      checked: 0,
      withValue: 0,
      zeroValueTried: 0,
      zeroValueNeverTried: 0,
      rows: [],
    },
    unclaimedAnonymousPasses: 0,
    newSubscriptions: {
      checked: 0,
      withValue: 0,
      zeroValueTried: 0,
      zeroValueNeverTried: 0,
      rows: [],
    },
  });
  const service = { getStatus } as unknown as PaidValueMonitorService;
  return { useCase: new GetPaidValueMonitorUseCase(service), getStatus };
};

const daysBetween = (since: Date, now: Date) =>
  Math.round((now.getTime() - since.getTime()) / (SECONDS_PER_DAY * 1000));

describe('GetPaidValueMonitorUseCase', () => {
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

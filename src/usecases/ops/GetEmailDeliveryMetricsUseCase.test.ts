import { GetEmailDeliveryMetricsUseCase } from './GetEmailDeliveryMetricsUseCase';
import { EmailDeliveryMetricsService } from '../../services/ops/EmailDeliveryMetricsService';

function makeUseCase() {
  const sinceDates: Date[] = [];
  const service = new EmailDeliveryMetricsService({
    repo: {
      countsByCategory: async (since: Date) => {
        sinceDates.push(since);
        return [{ category: 'deck-ready', event_type: 'delivered', count: 4 }];
      },
    },
  });
  return { useCase: new GetEmailDeliveryMetricsUseCase(service), sinceDates };
}

describe('GetEmailDeliveryMetricsUseCase', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-07T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns shaped categories for the default 30d window', async () => {
    const { useCase, sinceDates } = makeUseCase();

    const result = await useCase.execute(undefined);

    expect(result.window).toBe('30d');
    expect(result.by_category).toEqual([
      {
        category: 'deck-ready',
        delivered: 4,
        bounce: 0,
        dropped: 0,
        blocked: 0,
        deferred: 0,
        spamreport: 0,
        unsubscribe: 0,
        failure_rate: 0,
      },
    ]);
    expect(sinceDates[0]).toEqual(new Date('2026-08-08T12:00:00.000Z'));
  });

  it('maps a valid window to its day count', async () => {
    const { useCase, sinceDates } = makeUseCase();

    const result = await useCase.execute('7d');

    expect(result.window).toBe('7d');
    expect(sinceDates[0]).toEqual(new Date('2026-08-31T12:00:00.000Z'));
  });

  it('falls back to 30d for an unknown window', async () => {
    const { useCase } = makeUseCase();

    const result = await useCase.execute('1y');

    expect(result.window).toBe('30d');
  });
});

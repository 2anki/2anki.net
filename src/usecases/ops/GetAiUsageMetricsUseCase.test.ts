import { GetAiUsageMetricsUseCase } from './GetAiUsageMetricsUseCase';
import { AiUsageMetricsService } from '../../services/ops/AiUsageMetricsService';
import {
  AiUsageTotals,
  IAiUsageMetricsRepository,
} from '../../data_layer/AiUsageMetricsRepository';

const emptyTotals: AiUsageTotals = {
  calls: 0,
  cost_usd: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
};

function makeUseCase() {
  const sinceDates: Date[] = [];
  const repo: IAiUsageMetricsRepository = {
    totalsSince: async (since) => {
      sinceDates.push(since);
      return { ...emptyTotals, calls: 3, cost_usd: 1.25 };
    },
    totalsBySurface: async () => [
      { key: 'chat', ...emptyTotals, calls: 2, cost_usd: 1 },
    ],
    totalsByModel: async () => [
      { key: 'claude-sonnet-5', ...emptyTotals, calls: 3, cost_usd: 1.25 },
    ],
    totalsByDay: async () => [],
  };
  const useCase = new GetAiUsageMetricsUseCase(
    new AiUsageMetricsService({ repo })
  );
  return { useCase, sinceDates };
}

describe('GetAiUsageMetricsUseCase', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-13T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns totals with surface and model breakdowns for the default window', async () => {
    const { useCase, sinceDates } = makeUseCase();

    const result = await useCase.execute(undefined);

    expect(result).toEqual({
      window: '30d',
      totals: { ...emptyTotals, calls: 3, cost_usd: 1.25 },
      by_surface: [{ key: 'chat', ...emptyTotals, calls: 2, cost_usd: 1 }],
      by_model: [
        { key: 'claude-sonnet-5', ...emptyTotals, calls: 3, cost_usd: 1.25 },
      ],
      by_day: [],
    });
    expect(sinceDates[0]).toEqual(new Date('2026-07-14T12:00:00.000Z'));
  });

  it('maps a valid window to its day count', async () => {
    const { useCase, sinceDates } = makeUseCase();

    const result = await useCase.execute('7d');

    expect(result.window).toBe('7d');
    expect(sinceDates[0]).toEqual(new Date('2026-08-06T12:00:00.000Z'));
  });

  it('falls back to 30d for an unknown window', async () => {
    const { useCase } = makeUseCase();

    const result = await useCase.execute('1y');

    expect(result.window).toBe('30d');
  });
});

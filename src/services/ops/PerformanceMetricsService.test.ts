import {
  PerformanceMetricsService,
  capSignupCountries,
  SIGNUP_COUNTRIES_PANEL_LIMIT,
} from './PerformanceMetricsService';
import { InMemoryUserVisibleErrorsRepository } from '../../data_layer/UserVisibleErrorsRepository';
import type { IUserVisibleErrorsRepository } from '../../data_layer/UserVisibleErrorsRepository';

function buildMockDb() {
  return {
    raw: jest.fn().mockResolvedValue({
      rows: [{ p50: null, p95: null, p99: null, total: '0' }],
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('capSignupCountries', () => {
  const row = (country: string, count: number) => ({ country, count });

  it('caps the list at the panel limit and sums the remainder into others', () => {
    const rows = Array.from({ length: 14 }, (_, i) =>
      row(`C${i.toString().padStart(2, '0')}`, 100 - i)
    );

    const { top, others } = capSignupCountries(rows);

    expect(top).toHaveLength(SIGNUP_COUNTRIES_PANEL_LIMIT);
    expect(top[0]).toEqual(row('C00', 100));
    expect(others).toBe(
      rows
        .slice(SIGNUP_COUNTRIES_PANEL_LIMIT)
        .reduce((sum, r) => sum + r.count, 0)
    );
  });

  it('returns everything with zero others when under the limit', () => {
    const rows = [row('DE', 5), row('US', 3)];

    const { top, others } = capSignupCountries(rows);

    expect(top).toEqual(rows);
    expect(others).toBe(0);
  });
});

describe('PerformanceMetricsService.getUserVisibleErrorCounts', () => {
  it('returns empty array when no repository is provided', async () => {
    const service = new PerformanceMetricsService(buildMockDb());

    const result = await service.getUserVisibleErrorCounts(1);

    expect(result).toEqual([]);
  });

  it('returns counts from the repository', async () => {
    const repo = new InMemoryUserVisibleErrorsRepository();
    await repo.record({
      userId: null,
      surface: 'oauth_google',
      code: 'oauth_cancelled',
    });
    await repo.record({
      userId: null,
      surface: 'oauth_google',
      code: 'oauth_cancelled',
    });
    await repo.record({
      userId: null,
      surface: 'stripe_webhook',
      code: 'stripe_webhook_signature_invalid',
    });

    const service = new PerformanceMetricsService(buildMockDb(), repo);

    const result = await service.getUserVisibleErrorCounts(1);

    expect(result).toEqual([
      { surface: 'oauth_google', code: 'oauth_cancelled', count: 2 },
      {
        surface: 'stripe_webhook',
        code: 'stripe_webhook_signature_invalid',
        count: 1,
      },
    ]);
  });

  it('respects the sinceDays window (24h vs 7d filter)', async () => {
    const repo: IUserVisibleErrorsRepository = {
      record: jest.fn(),
      countBySurfaceAndCode: jest
        .fn()
        .mockResolvedValueOnce([
          { surface: 'oauth_google', code: 'oauth_cancelled', count: 3 },
        ])
        .mockResolvedValueOnce([
          { surface: 'oauth_google', code: 'oauth_cancelled', count: 10 },
          {
            surface: 'stripe_webhook',
            code: 'stripe_webhook_signature_invalid',
            count: 5,
          },
        ]),
    };

    const service = new PerformanceMetricsService(buildMockDb(), repo);

    const result24h = await service.getUserVisibleErrorCounts(1);
    const result7d = await service.getUserVisibleErrorCounts(7);

    expect(repo.countBySurfaceAndCode).toHaveBeenCalledWith(1);
    expect(repo.countBySurfaceAndCode).toHaveBeenCalledWith(7);
    expect(result24h).toHaveLength(1);
    expect(result7d).toHaveLength(2);
  });
});

describe('PerformanceMetricsService — user_visible_errors fields in getMetrics', () => {
  it('calls countBySurfaceAndCode with 1 and 7 for the two windows', async () => {
    const repo: IUserVisibleErrorsRepository = {
      record: jest.fn(),
      countBySurfaceAndCode: jest.fn().mockResolvedValue([]),
    };

    const service = new PerformanceMetricsService(buildMockDb(), repo);

    await service.getUserVisibleErrorCounts(1);
    await service.getUserVisibleErrorCounts(7);

    expect(repo.countBySurfaceAndCode).toHaveBeenCalledWith(1);
    expect(repo.countBySurfaceAndCode).toHaveBeenCalledWith(7);
  });
});

import type {
  ConversionOutcomeCounts,
  ConversionTier,
  IEventsMetricsRepository,
} from '../../data_layer/EventsMetricsRepository';
import type { IJobsMetricsRepository } from '../../data_layer/JobsMetricsRepository';
import type { ConversionErrorCount } from './ConversionMetricsService';
import {
  ConversionMetricsService,
  MIN_COHORT_SAMPLE,
} from './ConversionMetricsService';

function makeFailingRepo(): IJobsMetricsRepository {
  return {
    topFailureReasons7d: jest.fn().mockRejectedValue(new Error('db down')),
    failedConversionsWeekly: jest.fn().mockRejectedValue(new Error('db down')),
  };
}

function makeStubRepo(
  overrides: Partial<IJobsMetricsRepository> = {}
): IJobsMetricsRepository {
  return {
    topFailureReasons7d: jest.fn().mockResolvedValue([]),
    failedConversionsWeekly: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeFailingEventsRepo(): IEventsMetricsRepository {
  return {
    newAccountDownloads: jest.fn().mockRejectedValue(new Error('db down')),
    uploadToDownloadRate: jest.fn().mockRejectedValue(new Error('db down')),
    conversionOutcomes: jest.fn().mockRejectedValue(new Error('db down')),
  };
}

function makeStubEventsRepo(
  overrides: Partial<IEventsMetricsRepository> = {}
): IEventsMetricsRepository {
  return {
    newAccountDownloads: jest.fn().mockResolvedValue(null),
    uploadToDownloadRate: jest.fn().mockResolvedValue(null),
    conversionOutcomes: jest.fn().mockResolvedValue(outcomes()),
    ...overrides,
  };
}

function outcomes(
  overrides: Partial<ConversionOutcomeCounts> = {}
): ConversionOutcomeCounts {
  return { succeeded: 0, technicalFailed: 0, planBlocked: 0, ...overrides };
}

function eventsRepoWithOutcomes(
  byTier: Partial<Record<ConversionTier, Partial<ConversionOutcomeCounts>>>
): IEventsMetricsRepository {
  return makeStubEventsRepo({
    conversionOutcomes: jest
      .fn()
      .mockImplementation(async (_since: Date, tier: ConversionTier) =>
        outcomes(byTier[tier])
      ),
  });
}

afterEach(() => {
  jest.useRealTimers();
});

describe('ConversionMetricsService — graceful failure', () => {
  it('returns null for every metric when the repository throws', async () => {
    const service = new ConversionMetricsService(
      makeFailingRepo(),
      makeFailingEventsRepo()
    );
    const metrics = await service.getMetrics();

    expect(metrics.free_conversions_7d).toBeNull();
    expect(metrics.paid_conversions_7d).toBeNull();
    expect(metrics.free_conversion_success_rate_7d).toBeNull();
    expect(metrics.paid_conversion_success_rate_7d).toBeNull();
    expect(metrics.free_blocked_by_plan_7d).toBeNull();
    expect(metrics.paid_blocked_by_plan_7d).toBeNull();
    expect(metrics.conversion_errors_7d_top_reasons).toBeNull();
    expect(metrics.failed_conversions_weekly).toBeNull();
    expect(metrics.new_accounts_downloaded_24h_rate_30d).toBeNull();
    expect(
      metrics.new_accounts_downloaded_after_signup_24h_rate_30d
    ).toBeNull();
    expect(metrics.upload_to_download_rate_7d).toBeNull();
  });
});

describe('ConversionMetricsService — shape assembly', () => {
  it('counts free and paid conversions from succeeded events', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      eventsRepoWithOutcomes({
        free: { succeeded: 7 },
        paid: { succeeded: 3 },
      })
    );

    const metrics = await service.getMetrics();

    expect(metrics.free_conversions_7d).toBe(7);
    expect(metrics.paid_conversions_7d).toBe(3);
  });

  it('computes the success rate as succeeded over succeeded plus technical failures', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      eventsRepoWithOutcomes({
        free: { succeeded: 9, technicalFailed: 1 },
        paid: { succeeded: 3, technicalFailed: 1 },
      })
    );

    const metrics = await service.getMetrics();

    expect(metrics.free_conversion_success_rate_7d).toBe(90);
    expect(metrics.paid_conversion_success_rate_7d).toBe(75);
  });

  it('keeps plan blocks out of the success-rate denominator', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      eventsRepoWithOutcomes({
        free: { succeeded: 8, technicalFailed: 2, planBlocked: 500 },
      })
    );

    const metrics = await service.getMetrics();

    expect(metrics.free_conversion_success_rate_7d).toBe(80);
  });

  it('reports a success rate of 100 when nothing failed technically', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      eventsRepoWithOutcomes({ free: { succeeded: 4, planBlocked: 9 } })
    );

    const metrics = await service.getMetrics();

    expect(metrics.free_conversion_success_rate_7d).toBe(100);
  });

  it('returns a null success rate for a tier with no conversions or failures', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      eventsRepoWithOutcomes({ free: { planBlocked: 12 } })
    );

    const metrics = await service.getMetrics();

    expect(metrics.free_conversion_success_rate_7d).toBeNull();
    expect(metrics.paid_conversion_success_rate_7d).toBeNull();
  });

  it('passes through the plan-blocked counts per tier', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      eventsRepoWithOutcomes({
        free: { planBlocked: 18 },
        paid: { planBlocked: 2 },
      })
    );

    const metrics = await service.getMetrics();

    expect(metrics.free_blocked_by_plan_7d).toBe(18);
    expect(metrics.paid_blocked_by_plan_7d).toBe(2);
  });

  it('nulls only the tier whose query failed', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      makeStubEventsRepo({
        conversionOutcomes: jest
          .fn()
          .mockImplementation(async (_since: Date, tier: ConversionTier) => {
            if (tier === 'free') throw new Error('db down');
            return outcomes({ succeeded: 5 });
          }),
      })
    );

    const metrics = await service.getMetrics();

    expect(metrics.free_conversions_7d).toBeNull();
    expect(metrics.free_conversion_success_rate_7d).toBeNull();
    expect(metrics.free_blocked_by_plan_7d).toBeNull();
    expect(metrics.paid_conversions_7d).toBe(5);
  });

  it('reads both tiers over the last seven days', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-05-19T00:00:00.000Z'));
    const eventsRepo = makeStubEventsRepo();
    const service = new ConversionMetricsService(makeStubRepo(), eventsRepo);

    await service.getMetrics();

    const sevenDaysAgo = new Date('2025-05-12T00:00:00.000Z');
    expect(eventsRepo.conversionOutcomes).toHaveBeenCalledWith(
      sevenDaysAgo,
      'free'
    );
    expect(eventsRepo.conversionOutcomes).toHaveBeenCalledWith(
      sevenDaysAgo,
      'paid'
    );
    jest.useRealTimers();
  });

  it('passes through top failure reasons from the repository', async () => {
    const reasons: ConversionErrorCount[] = [
      { reason: 'rate limit', count: 5 },
      { reason: 'timeout', count: 2 },
    ];
    const service = new ConversionMetricsService(
      makeStubRepo({
        topFailureReasons7d: jest.fn().mockResolvedValue(reasons),
      }),
      makeStubEventsRepo()
    );

    const metrics = await service.getMetrics();

    expect(metrics.conversion_errors_7d_top_reasons).toEqual(reasons);
  });

  it('produces a 12-week time series with zeroes for weeks with no data', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo({
        failedConversionsWeekly: jest.fn().mockResolvedValue([]),
      }),
      makeStubEventsRepo()
    );

    const metrics = await service.getMetrics();

    expect(metrics.failed_conversions_weekly).toHaveLength(12);
    expect(
      metrics.failed_conversions_weekly?.every((pt) => pt.count === 0)
    ).toBe(true);
  });

  it('fills in counts for weeks that have data', async () => {
    const now = new Date('2025-05-19T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(now);

    const currentMonday = new Date('2025-05-19T00:00:00.000Z');
    const repo = makeStubRepo({
      failedConversionsWeekly: jest
        .fn()
        .mockResolvedValue([{ weekStart: currentMonday, count: 4 }]),
    });

    const service = new ConversionMetricsService(repo, makeStubEventsRepo());
    const metrics = await service.getMetrics();

    const weekly = metrics.failed_conversions_weekly ?? [];
    const lastPoint = weekly[weekly.length - 1];
    expect(lastPoint?.count).toBe(4);
    expect(lastPoint?.week).toBe('2025-05-19');

    jest.useRealTimers();
  });

  it('turns new-account download counts into shares of the accounts that could have downloaded', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      makeStubEventsRepo({
        newAccountDownloads: jest.fn().mockResolvedValue({
          accounts: 200,
          downloadedWithin24h: 100,
          downloadedAfterSignup: 30,
        }),
      })
    );

    const metrics = await service.getMetrics();

    expect(metrics.new_accounts_downloaded_24h_rate_30d).toBe(50);
    expect(metrics.new_accounts_downloaded_after_signup_24h_rate_30d).toBe(15);
  });

  it('reads no share when no new account is old enough to have had a day', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      makeStubEventsRepo({
        newAccountDownloads: jest.fn().mockResolvedValue({
          accounts: 0,
          downloadedWithin24h: 0,
          downloadedAfterSignup: 0,
        }),
      })
    );

    const metrics = await service.getMetrics();

    expect(metrics.new_accounts_downloaded_24h_rate_30d).toBeNull();
  });

  it('passes through the upload-to-download rate from the events repository', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      makeStubEventsRepo({
        uploadToDownloadRate: jest.fn().mockResolvedValue(25),
      })
    );

    const metrics = await service.getMetrics();

    expect(metrics.upload_to_download_rate_7d).toBe(25);
  });

  it('takes accounts from 30 days ago until a day ago, and the download rate over 7 days', async () => {
    const now = new Date('2026-11-19T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(now);

    const eventsRepo = makeStubEventsRepo();
    const service = new ConversionMetricsService(makeStubRepo(), eventsRepo);

    await service.getMetrics();

    expect(eventsRepo.newAccountDownloads).toHaveBeenCalledWith(
      new Date('2026-10-20T00:00:00.000Z'),
      new Date('2026-11-18T00:00:00.000Z')
    );
    expect(eventsRepo.uploadToDownloadRate).toHaveBeenCalledWith(
      new Date('2026-11-12T00:00:00.000Z')
    );

    jest.useRealTimers();
  });

  it('starts the account cohort no earlier than the day account_created became reliable', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-20T00:00:00.000Z'));

    const eventsRepo = makeStubEventsRepo();
    const service = new ConversionMetricsService(makeStubRepo(), eventsRepo);

    await service.getMetrics();

    expect(eventsRepo.newAccountDownloads).toHaveBeenCalledWith(
      new Date('2026-09-09T00:00:00.000Z'),
      new Date('2026-09-19T00:00:00.000Z')
    );

    jest.useRealTimers();
  });

  it('does not query when the reliable cohort has not reached a whole day yet', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-09T12:00:00.000Z'));

    const eventsRepo = makeStubEventsRepo();
    const metrics = await new ConversionMetricsService(
      makeStubRepo(),
      eventsRepo
    ).getMetrics();

    expect(eventsRepo.newAccountDownloads).not.toHaveBeenCalled();
    expect(metrics.new_accounts_downloaded_24h_rate_30d).toBeNull();

    jest.useRealTimers();
  });
});

describe('ConversionMetricsService — deck quality cohorts', () => {
  function makeScoresRepo(rows: unknown[]) {
    return {
      record: jest.fn().mockResolvedValue(undefined),
      distribution: jest.fn().mockResolvedValue(rows),
    } as never;
  }

  const fullCohort = {
    engine: 'parser',
    inputFormat: 'pdf',
    sampleSize: 120,
    shapedSampleSize: 118,
    noCardsCount: 8,
    firstSeen: '2026-07-01',
    lastSeen: '2026-07-28',
    compositeP10: 0.41,
    compositeP25: 0.5,
    compositeP50: 0.63,
    compositeP90: 0.82,
    cardCountP50: 34,
    medianBackLenP50: 180,
    blankBackRateP90: 0.05,
  };

  it('reports percentiles for a cohort with enough conversions', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      makeStubEventsRepo(),
      makeScoresRepo([fullCohort])
    );

    const result = await service.getMetrics();
    expect(result.deck_quality_cohorts_30d).toEqual([
      expect.objectContaining({
        engine: 'parser',
        input_format: 'pdf',
        enough_data: true,
        composite_p50: 0.63,
      }),
    ]);
  });

  it('withholds percentiles below the minimum sample but keeps the cohort visible', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      makeStubEventsRepo(),
      makeScoresRepo([{ ...fullCohort, sampleSize: MIN_COHORT_SAMPLE - 1 }])
    );

    const cohorts = (await service.getMetrics()).deck_quality_cohorts_30d;
    expect(cohorts).toHaveLength(1);
    expect(cohorts![0]).toMatchObject({
      enough_data: false,
      composite_p50: null,
      composite_p10: null,
    });
    expect(cohorts![0].sample_size).toBe(MIN_COHORT_SAMPLE - 1);
  });

  it('counts a zero-card conversion in the no-cards rate, not the score sample', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      makeStubEventsRepo(),
      makeScoresRepo([{ ...fullCohort, sampleSize: 92, noCardsCount: 8 }])
    );

    const cohorts = (await service.getMetrics()).deck_quality_cohorts_30d;
    expect(cohorts![0].no_cards_rate).toBeCloseTo(8 / 100);
  });

  it('returns null rather than throwing when no scores repository is wired', async () => {
    const service = new ConversionMetricsService(
      makeStubRepo(),
      makeStubEventsRepo()
    );
    expect((await service.getMetrics()).deck_quality_cohorts_30d).toBeNull();
  });
});

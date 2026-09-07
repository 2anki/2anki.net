import {
  EmailDeliveryMetricsService,
  shapeEmailDeliveryCounts,
} from './EmailDeliveryMetricsService';

describe('shapeEmailDeliveryCounts', () => {
  it('pivots counts into one row per category with a failure rate', () => {
    const rows = shapeEmailDeliveryCounts([
      { category: 'magic-link-login', event_type: 'delivered', count: 90 },
      { category: 'magic-link-login', event_type: 'bounce', count: 8 },
      { category: 'magic-link-login', event_type: 'dropped', count: 2 },
      { category: 'deck-ready', event_type: 'delivered', count: 50 },
      { category: 'deck-ready', event_type: 'deferred', count: 5 },
    ]);

    expect(rows).toEqual([
      {
        category: 'magic-link-login',
        delivered: 90,
        bounce: 8,
        dropped: 2,
        blocked: 0,
        deferred: 0,
        spamreport: 0,
        unsubscribe: 0,
        failure_rate: 10,
      },
      {
        category: 'deck-ready',
        delivered: 50,
        bounce: 0,
        dropped: 0,
        blocked: 0,
        deferred: 5,
        spamreport: 0,
        unsubscribe: 0,
        failure_rate: 0,
      },
    ]);
  });

  it('ignores unknown event types and rates an all-failure category at 100', () => {
    const rows = shapeEmailDeliveryCounts([
      { category: 'pass-winback', event_type: 'bounce', count: 3 },
      { category: 'pass-winback', event_type: 'open', count: 40 },
    ]);

    expect(rows).toEqual([
      {
        category: 'pass-winback',
        delivered: 0,
        bounce: 3,
        dropped: 0,
        blocked: 0,
        deferred: 0,
        spamreport: 0,
        unsubscribe: 0,
        failure_rate: 100,
      },
    ]);
  });
});

describe('EmailDeliveryMetricsService', () => {
  it('reads counts for the window and returns shaped categories', async () => {
    const since = new Date('2026-08-08T00:00:00.000Z');
    const seen: Date[] = [];
    const service = new EmailDeliveryMetricsService({
      repo: {
        countsByCategory: async (s: Date) => {
          seen.push(s);
          return [
            { category: 'deck-ready', event_type: 'delivered', count: 1 },
          ];
        },
      },
    });

    const result = await service.getMetrics(since);

    expect(seen).toEqual([since]);
    expect(result.by_category).toHaveLength(1);
    expect(result.by_category[0]).toMatchObject({
      category: 'deck-ready',
      delivered: 1,
      failure_rate: 0,
    });
  });
});

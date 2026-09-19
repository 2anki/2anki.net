import { UploadFunnelService } from './UploadFunnelService';
import type {
  IEventsRepository,
  UploadFunnelStageRow,
  UploadFunnelStageByOriginRow,
  ConversionFailedByReasonRow,
} from '../../data_layer/EventsRepository';

const NO_FAILURES: ConversionFailedByReasonRow = {
  paywall: 0,
  empty: 0,
  technical: 0,
};

function makeRepo(
  rows: UploadFunnelStageRow[],
  originRows: UploadFunnelStageByOriginRow[] = [],
  failedByReason: ConversionFailedByReasonRow = NO_FAILURES
): IEventsRepository {
  return {
    insertEvents: jest.fn(),
    countByName: jest.fn(),
    countDistinctUsers: jest.fn(),
    countByNameForUser: jest.fn(),
    lastEventAt: jest.fn(),
    groupPaywallShownByVariantAndSurface: jest.fn(),
    groupPaywallClicksByVariant: jest.fn(),
    groupUploadFunnel: jest.fn().mockResolvedValue(rows),
    groupUploadFunnelByOrigin: jest.fn().mockResolvedValue(originRows),
    groupConversionFailedByReason: jest.fn().mockResolvedValue(failedByReason),
  };
}

describe('UploadFunnelService', () => {
  const since = new Date('2026-05-01T00:00:00Z');

  it('returns per-stage distinct-identity counts', async () => {
    const repo = makeRepo([
      { stage: 'upload_started', distinct_identities: 100 },
      { stage: 'conversion_succeeded', distinct_identities: 72 },
      { stage: 'conversion_failed', distinct_identities: 20 },
      { stage: 'deck_downloaded', distinct_identities: 60 },
    ]);
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.stages).toEqual({
      upload_started: 100,
      conversion_succeeded: 72,
      conversion_failed: 20,
      deck_downloaded: 60,
      paywall_shown: 0,
      signup: 0,
      paid: 0,
    });
    expect(result.since).toBe(since.toISOString());
  });

  it('carries the account_created count through to the signup stage', async () => {
    const repo = makeRepo([
      { stage: 'deck_downloaded', distinct_identities: 60 },
      { stage: 'account_created', distinct_identities: 18 },
    ]);
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.stages?.signup).toBe(18);
  });

  it('computes the download to signup conversion rate', async () => {
    const repo = makeRepo([
      { stage: 'deck_downloaded', distinct_identities: 80 },
      { stage: 'account_created', distinct_identities: 20 },
    ]);
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.download_to_signup_rate_pct).toBe(25);
  });

  it('reports a zero signup rate when no decks were downloaded', async () => {
    const repo = makeRepo([
      { stage: 'account_created', distinct_identities: 5 },
    ]);
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.stages?.deck_downloaded).toBe(0);
    expect(result.download_to_signup_rate_pct).toBe(0);
  });

  it('carries the paywall_shown and paid stages through to the response', async () => {
    const repo = makeRepo([
      { stage: 'upload_started', distinct_identities: 100 },
      { stage: 'deck_downloaded', distinct_identities: 60 },
      { stage: 'paywall_shown', distinct_identities: 30 },
      { stage: 'checkout_completed', distinct_identities: 12 },
    ]);
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.stages?.paywall_shown).toBe(30);
    expect(result.stages?.paid).toBe(12);
  });

  it('computes the download to paid conversion rate', async () => {
    const repo = makeRepo([
      { stage: 'deck_downloaded', distinct_identities: 80 },
      { stage: 'checkout_completed', distinct_identities: 20 },
    ]);
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.download_to_paid_rate_pct).toBe(25);
  });

  it('reports a zero paid rate when no decks were downloaded', async () => {
    const repo = makeRepo([
      { stage: 'checkout_completed', distinct_identities: 5 },
    ]);
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.stages?.deck_downloaded).toBe(0);
    expect(result.download_to_paid_rate_pct).toBe(0);
  });

  it('computes the true upload to download success rate', async () => {
    const repo = makeRepo([
      { stage: 'upload_started', distinct_identities: 200 },
      { stage: 'deck_downloaded', distinct_identities: 50 },
    ]);
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.upload_to_download_rate_pct).toBe(25);
  });

  it('reports a zero rate when no uploads started', async () => {
    const repo = makeRepo([
      { stage: 'deck_downloaded', distinct_identities: 10 },
    ]);
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.stages?.upload_started).toBe(0);
    expect(result.upload_to_download_rate_pct).toBe(0);
  });

  it('breaks the funnel down per signup origin, ordered by upload volume', async () => {
    const repo = makeRepo(
      [{ stage: 'upload_started', distinct_identities: 150 }],
      [
        { origin: '/nclex', stage: 'upload_started', distinct_identities: 100 },
        { origin: '/nclex', stage: 'deck_downloaded', distinct_identities: 40 },
        {
          origin: '/nclex',
          stage: 'checkout_completed',
          distinct_identities: 8,
        },
        { origin: '/mcat', stage: 'upload_started', distinct_identities: 50 },
        { origin: null, stage: 'upload_started', distinct_identities: 25 },
      ]
    );
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.by_origin.map((b) => b.origin)).toEqual([
      '/nclex',
      '/mcat',
      null,
    ]);
    const nclex = result.by_origin[0];
    expect(nclex.stages.upload_started).toBe(100);
    expect(nclex.stages.deck_downloaded).toBe(40);
    expect(nclex.stages.paid).toBe(8);
    expect(nclex.upload_to_download_rate_pct).toBe(40);
    expect(nclex.download_to_paid_rate_pct).toBe(20);
  });

  it('returns an empty per-origin breakdown when there are no events', async () => {
    const repo = makeRepo([]);
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.by_origin).toEqual([]);
  });

  it('splits conversion_failed into paywall, empty, and technical buckets', async () => {
    const repo = makeRepo(
      [{ stage: 'conversion_failed', distinct_identities: 42 }],
      [],
      { paywall: 25, empty: 12, technical: 5 }
    );
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.conversion_failed_by_reason).toEqual({
      paywall: 25,
      empty: 12,
      technical: 5,
    });
  });

  it('reports zeroed reason buckets on a repository error', async () => {
    const repo = makeRepo([]);
    (repo.groupConversionFailedByReason as jest.Mock).mockRejectedValueOnce(
      new Error('db down')
    );
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.conversion_failed_by_reason).toEqual({
      paywall: 0,
      empty: 0,
      technical: 0,
    });
    expect(result.error).toBe('db down');
  });

  it('surfaces a repository error without throwing', async () => {
    const repo = makeRepo([]);
    (repo.groupUploadFunnel as jest.Mock).mockRejectedValueOnce(
      new Error('db down')
    );
    const service = new UploadFunnelService({ eventsRepo: repo });

    const result = await service.getMetrics(since);

    expect(result.stages).toBeNull();
    expect(result.error).toBe('db down');
  });

  describe('signup reliability guard', () => {
    const reliableSince = new Date('2026-09-08T00:00:00.000Z');
    const beforeFix = new Date('2026-08-20T00:00:00.000Z');
    const afterFix = new Date('2026-09-12T00:00:00.000Z');

    it('flags the signup stage reliable when the window starts after the fix', async () => {
      const repo = makeRepo([
        { stage: 'account_created', distinct_identities: 18 },
      ]);
      const service = new UploadFunnelService({ eventsRepo: repo });

      const result = await service.getMetrics(afterFix);

      expect(result.signup_reliable).toBe(true);
    });

    it('treats a window starting exactly on the fix boundary as reliable', async () => {
      const repo = makeRepo([]);
      const service = new UploadFunnelService({ eventsRepo: repo });

      const result = await service.getMetrics(reliableSince);

      expect(result.signup_reliable).toBe(true);
    });

    it('flags the signup stage unreliable when the window starts before the fix', async () => {
      const repo = makeRepo([
        { stage: 'account_created', distinct_identities: 18 },
      ]);
      const service = new UploadFunnelService({ eventsRepo: repo });

      const result = await service.getMetrics(beforeFix);

      expect(result.signup_reliable).toBe(false);
    });

    it('reports the signup stage as unreliable on the error path too', async () => {
      const repo = makeRepo([]);
      (repo.groupUploadFunnel as jest.Mock).mockRejectedValueOnce(
        new Error('db down')
      );
      const service = new UploadFunnelService({ eventsRepo: repo });

      const result = await service.getMetrics(beforeFix);

      expect(result.signup_reliable).toBe(false);
      expect(result.error).toBe('db down');
    });
  });
});

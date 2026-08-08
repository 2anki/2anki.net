import type { UserPassWindowRow } from '../../data_layer/UserPassRepository';
import type { AnonymousPassWindowRow } from '../../data_layer/AnonymousPassRepository';
import type { PaidValueEventRow } from '../../data_layer/EventsMetricsRepository';
import type { NewSubscriptionWithUserRow } from '../../data_layer/PaidValueSubscriptionsRepository';
import { PaidValueMonitorService } from './PaidValueMonitorService';

const NOW = new Date('2026-07-14T12:00:00.000Z');
const SINCE = new Date('2026-07-07T12:00:00.000Z');

interface Fixture {
  userPasses?: UserPassWindowRow[];
  anonymousPasses?: AnonymousPassWindowRow[];
  subscriptions?: NewSubscriptionWithUserRow[];
  events?: PaidValueEventRow[];
}

const buildService = (fixture: Fixture) => {
  const eventsCapture = {
    userIds: [] as number[],
    since: null as Date | null,
  };
  const service = new PaidValueMonitorService({
    userPasses: {
      listActiveInWindow: async () => fixture.userPasses ?? [],
    },
    anonymousPasses: {
      listActiveInWindow: async () => fixture.anonymousPasses ?? [],
    },
    subscriptions: {
      listNewWithUserId: async () => fixture.subscriptions ?? [],
    },
    events: {
      listPaidValueEvents: async (userIds, since) => {
        eventsCapture.userIds = userIds;
        eventsCapture.since = since;
        return (fixture.events ?? []).filter((event) =>
          userIds.includes(event.userId)
        );
      },
    },
  });
  return { service, eventsCapture };
};

describe('PaidValueMonitorService', () => {
  it('counts a pass with a successful conversion as value delivered', async () => {
    const { service, eventsCapture } = buildService({
      userPasses: [
        {
          id: 1,
          userId: 100,
          kind: '7d',
          expiresAt: new Date('2026-07-13T12:00:00.000Z'),
        },
      ],
      events: [
        {
          userId: 100,
          name: 'conversion_succeeded',
          createdAt: new Date('2026-07-10T12:00:00.000Z'),
        },
      ],
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.passes).toEqual({
      checked: 1,
      withValue: 1,
      zeroValueTried: 0,
      zeroValueNeverTried: 0,
      rows: [],
    });
    expect(eventsCapture.since).toEqual(new Date('2026-07-06T12:00:00.000Z'));
  });

  it('classifies a pass with only failures as zero-value tried', async () => {
    const { service } = buildService({
      userPasses: [
        {
          id: 2,
          userId: 200,
          kind: '24h',
          expiresAt: new Date('2026-07-13T12:00:00.000Z'),
        },
      ],
      events: [
        {
          userId: 200,
          name: 'conversion_failed',
          createdAt: new Date('2026-07-12T18:00:00.000Z'),
        },
      ],
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.passes.zeroValueTried).toBe(1);
    expect(result.passes.withValue).toBe(0);
    expect(result.passes.rows).toEqual([
      {
        userId: 200,
        kind: '24h',
        expiresAt: '2026-07-13T12:00:00.000Z',
        successes: 0,
        downloads: 0,
        failures: 1,
        classification: 'tried',
      },
    ]);
  });

  it('classifies a pass with no events at all as zero-value never tried', async () => {
    const { service } = buildService({
      userPasses: [
        {
          id: 3,
          userId: 300,
          kind: '24h',
          expiresAt: new Date('2026-07-13T12:00:00.000Z'),
        },
      ],
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.passes.zeroValueNeverTried).toBe(1);
    expect(result.passes.rows[0]).toMatchObject({
      userId: 300,
      classification: 'never',
      successes: 0,
      downloads: 0,
      failures: 0,
    });
  });

  it('ignores events that fall outside the pass active window', async () => {
    const { service } = buildService({
      userPasses: [
        {
          id: 4,
          userId: 400,
          kind: '24h',
          expiresAt: new Date('2026-07-13T12:00:00.000Z'),
        },
      ],
      events: [
        {
          userId: 400,
          name: 'conversion_succeeded',
          createdAt: new Date('2026-07-08T12:00:00.000Z'),
        },
      ],
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.passes.withValue).toBe(0);
    expect(result.passes.zeroValueNeverTried).toBe(1);
    expect(result.passes.rows[0]).toMatchObject({
      classification: 'never',
      successes: 0,
    });
  });

  it('counts a new subscriber who converted inside their first paid week', async () => {
    const { service } = buildService({
      subscriptions: [
        { userId: 500, createdAt: new Date('2026-07-13T12:00:00.000Z') },
      ],
      events: [
        {
          userId: 500,
          name: 'conversion_succeeded',
          createdAt: new Date('2026-07-14T00:00:00.000Z'),
        },
      ],
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.newSubscriptions).toEqual({
      checked: 1,
      withValue: 1,
      zeroValueTried: 0,
      zeroValueNeverTried: 0,
      rows: [],
    });
  });

  it('defaults an unknown pass kind to a 24h window and warns', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { service } = buildService({
      userPasses: [
        {
          id: 6,
          userId: 600,
          kind: 'lifetime-typo',
          expiresAt: new Date('2026-07-13T12:00:00.000Z'),
        },
      ],
      events: [
        {
          userId: 600,
          name: 'conversion_succeeded',
          createdAt: new Date('2026-07-10T12:00:00.000Z'),
        },
      ],
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.passes.zeroValueNeverTried).toBe(1);
    expect(result.passes.rows[0]).toMatchObject({
      classification: 'never',
      successes: 0,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lifetime-typo'));
    warn.mockRestore();
  });

  it('counts unclaimed anonymous passes without attributing events, and attributes claimed ones', async () => {
    const { service } = buildService({
      anonymousPasses: [
        {
          id: 1,
          kind: '24h',
          createdAt: new Date('2026-07-13T00:00:00.000Z'),
          expiresAt: new Date('2026-07-14T00:00:00.000Z'),
          claimedByUserId: null,
        },
        {
          id: 2,
          kind: '24h',
          createdAt: new Date('2026-07-13T00:00:00.000Z'),
          expiresAt: new Date('2026-07-14T00:00:00.000Z'),
          claimedByUserId: 700,
        },
      ],
      events: [
        {
          userId: 700,
          name: 'conversion_failed',
          createdAt: new Date('2026-07-13T12:00:00.000Z'),
        },
      ],
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.unclaimedAnonymousPasses).toBe(1);
    expect(result.claimedAnonymousPasses.checked).toBe(1);
    expect(result.claimedAnonymousPasses.zeroValueTried).toBe(1);
    expect(result.claimedAnonymousPasses.rows).toEqual([
      {
        userId: 700,
        kind: '24h',
        expiresAt: '2026-07-14T00:00:00.000Z',
        successes: 0,
        downloads: 0,
        failures: 1,
        classification: 'tried',
      },
    ]);
  });
});

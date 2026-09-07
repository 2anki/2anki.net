import {
  AI_SPEND_ALERT_THRESHOLD_USD,
  AI_SPEND_DAILY_CAP_USD,
  AiSpendCapError,
  AiSpendGuardDeps,
  guardAiSpend,
} from './aiSpendGuard';
import { track } from '../../services/events/track';

jest.mock('../../services/events/track', () => ({
  track: jest.fn(),
}));

const trackMock = track as jest.Mock;

const NOW = new Date('2026-09-07T12:00:00.000Z');

function makeDeps(overrides: {
  costByWindow?: Record<string, number>;
  eventCount?: number;
}): AiSpendGuardDeps & {
  sendAlert: jest.Mock;
  reader: { userCostSince: jest.Mock; eventCountSince: jest.Mock };
} {
  const costByWindow = overrides.costByWindow ?? {};
  return {
    reader: {
      userCostSince: jest.fn((_userId: number, since: Date) => {
        const days = Math.round(
          (NOW.getTime() - since.getTime()) / (24 * 60 * 60 * 1000)
        );
        return Promise.resolve(costByWindow[`${days}d`] ?? 0);
      }),
      eventCountSince: jest.fn().mockResolvedValue(overrides.eventCount ?? 0),
    },
    sendAlert: jest.fn().mockResolvedValue(undefined),
    now: () => NOW,
  };
}

describe('guardAiSpend', () => {
  beforeEach(() => {
    trackMock.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing for anonymous callers', async () => {
    const deps = makeDeps({});
    await guardAiSpend(null, deps);
    expect(deps.reader.userCostSince).not.toHaveBeenCalled();
  });

  it('passes a user under both thresholds without notifying', async () => {
    const deps = makeDeps({ costByWindow: { '1d': 2, '30d': 10 } });
    await guardAiSpend(42, deps);
    expect(deps.sendAlert).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('throws AiSpendCapError at the daily cap and records the trip', async () => {
    const deps = makeDeps({
      costByWindow: { '1d': AI_SPEND_DAILY_CAP_USD, '30d': 80 },
    });

    await expect(guardAiSpend(42, deps)).rejects.toMatchObject({
      name: 'AiSpendCapError',
      status: 429,
      code: 'ai_spend_capped',
    });
    expect(trackMock).toHaveBeenCalledWith('ai_spend_cap_tripped', {
      userId: 42,
      props: {},
    });
    expect(deps.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('breaker tripped — user 42'),
      expect.stringContaining('$50.00')
    );
  });

  it('does not re-notify a breaker trip inside the dedup window but still throws', async () => {
    const deps = makeDeps({
      costByWindow: { '1d': 60, '30d': 80 },
      eventCount: 1,
    });

    await expect(guardAiSpend(42, deps)).rejects.toThrow(AiSpendCapError);
    expect(trackMock).not.toHaveBeenCalled();
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('emails the watch alert once when 30d spend crosses the threshold', async () => {
    const deps = makeDeps({
      costByWindow: { '1d': 1, '30d': AI_SPEND_ALERT_THRESHOLD_USD },
    });

    await guardAiSpend(42, deps);

    expect(trackMock).toHaveBeenCalledWith('ai_spend_alert_sent', {
      userId: 42,
      props: {},
    });
    expect(deps.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('crossed $25 in 30 days'),
      expect.stringContaining('user 42'.replace('user', 'User'))
    );
  });

  it('dedupes the watch alert inside seven days', async () => {
    const deps = makeDeps({
      costByWindow: { '1d': 1, '30d': 40 },
      eventCount: 1,
    });

    await guardAiSpend(42, deps);

    expect(trackMock).not.toHaveBeenCalled();
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('fails open when the spend read throws', async () => {
    const deps = makeDeps({});
    deps.reader.userCostSince.mockRejectedValue(new Error('db down'));

    await expect(guardAiSpend(42, deps)).resolves.toBeUndefined();
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('fails open when the alert email throws', async () => {
    const deps = makeDeps({ costByWindow: { '1d': 1, '30d': 30 } });
    deps.sendAlert.mockRejectedValue(new Error('sendgrid down'));

    await expect(guardAiSpend(42, deps)).resolves.toBeUndefined();
  });
});

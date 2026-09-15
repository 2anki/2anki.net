import {
  AI_SPEND_ALERT_THRESHOLD_USD,
  AiBudgetDeps,
  AiCreditsExhaustedError,
  assertAiBudget,
  getAiBudgetStatus,
  withAiBudget,
} from './aiSpendGuard';
import { AiCreditBalance } from './aiCredits/balance';
import {
  RESERVED_CREDITS_PER_INFLIGHT_CALL,
  reservedCreditsFor,
  resetInflightReservations,
} from './aiCredits/inflightReservations';
import { track } from '../../services/events/track';

jest.mock('../../services/events/track', () => ({ track: jest.fn() }));

const trackMock = track as jest.Mock;
const NOW = new Date('2026-09-07T12:00:00.000Z');

// The watch alert and the exhausted-event fire both run detached, so tests that
// assert on them flush the microtask/timer queue first.
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

function balanceWith(rawCredits: number): AiCreditBalance {
  return {
    rawCredits,
    credits: Math.max(0, Math.round(rawCredits)),
    allowance: 300,
    windowStart: new Date('2026-09-01T00:00:00.000Z'),
    windowEnd: new Date('2026-10-01T00:00:00.000Z'),
    resets: 'period',
  };
}

function makeDeps(overrides: {
  balance?: AiCreditBalance | null;
  cost30d?: number;
  eventCount?: number;
}): AiBudgetDeps & {
  sendAlert: jest.Mock;
  reader: { userCostSince: jest.Mock; eventCountSince: jest.Mock };
} {
  return {
    computeBalance: jest.fn().mockResolvedValue(overrides.balance ?? null),
    reader: {
      userCostSince: jest.fn().mockResolvedValue(overrides.cost30d ?? 0),
      eventCountSince: jest.fn().mockResolvedValue(overrides.eventCount ?? 0),
    },
    sendAlert: jest.fn().mockResolvedValue(undefined),
    now: () => NOW,
  };
}

describe('assertAiBudget', () => {
  beforeEach(() => {
    trackMock.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('does nothing for anonymous callers', async () => {
    const deps = makeDeps({});
    await assertAiBudget(null, deps);
    expect(deps.computeBalance).not.toHaveBeenCalled();
  });

  it('passes a user with credits remaining without notifying', async () => {
    const deps = makeDeps({ balance: balanceWith(180), cost30d: 3 });
    await assertAiBudget(42, deps);
    await flushAsync();
    expect(deps.sendAlert).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('throws AiCreditsExhaustedError at zero and fires the event once', async () => {
    const deps = makeDeps({ balance: balanceWith(-2) });
    await expect(assertAiBudget(42, deps)).rejects.toMatchObject({
      name: 'AiCreditsExhaustedError',
      status: 402,
      code: 'ai_credits_exhausted',
    });
    await flushAsync();
    expect(trackMock).toHaveBeenCalledWith('ai_credits_exhausted', {
      userId: 42,
      props: {},
    });
  });

  it('still throws but does not re-fire the event inside the same window', async () => {
    const deps = makeDeps({ balance: balanceWith(0), eventCount: 1 });
    await expect(assertAiBudget(42, deps)).rejects.toThrow(
      AiCreditsExhaustedError
    );
    await flushAsync();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('emails the watch alert once when 30d spend crosses the threshold', async () => {
    const deps = makeDeps({
      balance: balanceWith(180),
      cost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });
    await assertAiBudget(42, deps);
    await flushAsync();
    expect(trackMock).toHaveBeenCalledWith('ai_spend_alert_sent', {
      userId: 42,
      props: {},
    });
    expect(deps.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('crossed $25 in 30 days'),
      expect.stringContaining('User 42')
    );
  });

  it('dedupes the watch alert inside seven days', async () => {
    const deps = makeDeps({
      balance: balanceWith(180),
      cost30d: AI_SPEND_ALERT_THRESHOLD_USD,
      eventCount: 1,
    });
    await assertAiBudget(42, deps);
    await flushAsync();
    expect(deps.sendAlert).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalledWith('ai_spend_alert_sent', {
      userId: 42,
      props: {},
    });
  });

  it('fails open when the alert email throws', async () => {
    const deps = makeDeps({
      balance: balanceWith(180),
      cost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });
    (deps.sendAlert as jest.Mock).mockRejectedValue(new Error('smtp down'));
    await expect(assertAiBudget(42, deps)).resolves.toBeUndefined();
    await flushAsync();
    expect(deps.sendAlert).toHaveBeenCalled();
  });

  it('still fires the watch alert when the user is also exhausted', async () => {
    const deps = makeDeps({
      balance: balanceWith(0),
      cost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });
    await expect(assertAiBudget(42, deps)).rejects.toBeInstanceOf(
      AiCreditsExhaustedError
    );
    await flushAsync();
    expect(deps.sendAlert).toHaveBeenCalled();
  });

  it('fails open when the balance read throws', async () => {
    const deps = makeDeps({});
    (deps.computeBalance as jest.Mock).mockRejectedValue(new Error('db down'));
    await expect(assertAiBudget(42, deps)).resolves.toBeUndefined();
    await flushAsync();
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });
});

describe('withAiBudget', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    trackMock.mockReset();
    resetInflightReservations();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('runs the call without a balance check for anonymous callers', async () => {
    const deps = makeDeps({});
    const result = await withAiBudget(null, async () => 'ok', deps);
    expect(result).toBe('ok');
    expect(deps.computeBalance).not.toHaveBeenCalled();
  });

  it('runs the call and releases the reservation when credits remain', async () => {
    const deps = makeDeps({ balance: balanceWith(180) });
    const result = await withAiBudget(42, async () => 'ok', deps);
    expect(result).toBe('ok');
    expect(reservedCreditsFor(42)).toBe(0);
  });

  it('throws without running the call when the balance is spent', async () => {
    const deps = makeDeps({ balance: balanceWith(0) });
    const run = jest.fn().mockResolvedValue('ok');
    await expect(withAiBudget(42, run, deps)).rejects.toBeInstanceOf(
      AiCreditsExhaustedError
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('bounds concurrency: a second call is refused while the balance is fully reserved', async () => {
    const deps = makeDeps({
      balance: balanceWith(RESERVED_CREDITS_PER_INFLIGHT_CALL),
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withAiBudget(
      42,
      async () => {
        await gate;
        return 'first';
      },
      deps
    );
    await flush();
    expect(reservedCreditsFor(42)).toBe(RESERVED_CREDITS_PER_INFLIGHT_CALL);

    const second = jest.fn().mockResolvedValue('second');
    await expect(withAiBudget(42, second, deps)).rejects.toBeInstanceOf(
      AiCreditsExhaustedError
    );
    expect(second).not.toHaveBeenCalled();

    release();
    await expect(first).resolves.toBe('first');
    expect(reservedCreditsFor(42)).toBe(0);
  });

  it('releases the reservation when the call throws', async () => {
    const deps = makeDeps({ balance: balanceWith(180) });
    await expect(
      withAiBudget(
        42,
        async () => {
          throw new Error('boom');
        },
        deps
      )
    ).rejects.toThrow('boom');
    expect(reservedCreditsFor(42)).toBe(0);
  });

  it('emails the watch alert once when 30d spend crosses the threshold', async () => {
    const deps = makeDeps({
      balance: balanceWith(180),
      cost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });
    await withAiBudget(42, async () => 'ok', deps);
    await flush();
    expect(trackMock).toHaveBeenCalledWith('ai_spend_alert_sent', {
      userId: 42,
      props: {},
    });
    expect(deps.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('crossed $25 in 30 days'),
      expect.stringContaining('User 42')
    );
  });

  it('records the exhausted event when a call is refused by the reservation', async () => {
    const deps = makeDeps({
      balance: balanceWith(RESERVED_CREDITS_PER_INFLIGHT_CALL),
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withAiBudget(
      42,
      async () => {
        await gate;
        return 'first';
      },
      deps
    );
    await flush();

    const second = jest.fn().mockResolvedValue('second');
    await expect(withAiBudget(42, second, deps)).rejects.toBeInstanceOf(
      AiCreditsExhaustedError
    );
    await flush();
    expect(trackMock).toHaveBeenCalledWith('ai_credits_exhausted', {
      userId: 42,
      props: {},
    });

    release();
    await first;
  });
});

describe('getAiBudgetStatus', () => {
  beforeEach(() => {
    trackMock.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns not-exhausted with a null balance for anonymous callers', async () => {
    const status = await getAiBudgetStatus(null, makeDeps({}));
    expect(status).toEqual({ exhausted: false, balance: null });
  });

  it('proceeds for a user with credits remaining and fires nothing', async () => {
    const status = await getAiBudgetStatus(
      42,
      makeDeps({ balance: balanceWith(180) })
    );
    expect(status.exhausted).toBe(false);
    await flushAsync();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('marks exhaustion at the rounded-credits boundary, not raw credits', async () => {
    const status = await getAiBudgetStatus(
      42,
      makeDeps({ balance: balanceWith(0.4) })
    );
    expect(status.exhausted).toBe(true);
  });

  it('fires the exhausted event once per window from the reader', async () => {
    await getAiBudgetStatus(42, makeDeps({ balance: balanceWith(0) }));
    await flushAsync();
    expect(trackMock).toHaveBeenCalledWith('ai_credits_exhausted', {
      userId: 42,
      props: {},
    });
  });

  it('does not re-fire the exhausted event inside the same window', async () => {
    await getAiBudgetStatus(
      42,
      makeDeps({ balance: balanceWith(0), eventCount: 1 })
    );
    await flushAsync();
    expect(trackMock).not.toHaveBeenCalled();
  });
});

import { vi, type Mock } from 'vitest';
import {
  AI_SPEND_ALERT_THRESHOLD_USD,
  AiBudgetDeps,
  AiCreditsExhaustedError,
  assertAiBudget,
  getAiBudgetStatus,
  resetAiSpendClaims,
  withAiBudget,
} from './aiSpendGuard';
import { AiCreditBalance } from './aiCredits/balance';
import {
  RESERVED_CREDITS_PER_INFLIGHT_CALL,
  reservedCreditsFor,
  reservedCreditsForPass,
  resetInflightReservations,
} from './aiCredits/inflightReservations';
import { track } from '../../services/events/track';

vi.mock('../../services/events/track', () => ({ track: vi.fn() }));

const trackMock = track as Mock;
const NOW = new Date('2026-09-07T12:00:00.000Z');

// The watch alert and the exhausted-event fire both run detached, so tests that
// assert on them flush the microtask/timer queue first.
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

function balanceWith(rawCredits: number): AiCreditBalance {
  return {
    rawCredits,
    credits: Math.max(0, Math.round(rawCredits)),
    spent: Math.max(0, Math.round(300 - rawCredits)),
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
  sendAlert: Mock;
  reader: { userRecordedCostSince: Mock; eventCountSince: Mock };
} {
  return {
    computeBalance: vi.fn().mockResolvedValue(overrides.balance ?? null),
    reader: {
      userRecordedCostSince: vi.fn().mockResolvedValue(overrides.cost30d ?? 0),
      eventCountSince: vi.fn().mockResolvedValue(overrides.eventCount ?? 0),
    },
    sendAlert: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
  };
}

describe('assertAiBudget', () => {
  beforeEach(() => {
    trackMock.mockReset();
    resetAiSpendClaims();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

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
      props: { server_marker: true },
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
      props: { server_marker: true },
    });
    expect(deps.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('crossed $25 in 30 days'),
      expect.stringContaining('User 42')
    );
  });

  it('emails the watch alert once when many guards for one user cross the threshold together', async () => {
    const deps = makeDeps({
      balance: balanceWith(200),
      cost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });

    await Promise.all(
      Array.from({ length: 5 }, () => assertAiBudget(42, deps))
    );
    await flushAsync();

    expect(deps.sendAlert).toHaveBeenCalledTimes(1);
    expect(
      trackMock.mock.calls.filter(([name]) => name === 'ai_spend_alert_sent')
    ).toHaveLength(1);
  });

  it('checks again after a failed spend read, so the alert still goes out', async () => {
    const deps = makeDeps({
      balance: balanceWith(200),
      cost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });
    deps.reader.userRecordedCostSince.mockRejectedValueOnce(
      new Error('db down')
    );

    await assertAiBudget(42, deps);
    await flushAsync();
    await assertAiBudget(42, deps);
    await flushAsync();

    expect(deps.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('checks again while spend is under the threshold', async () => {
    const deps = makeDeps({ balance: balanceWith(200), cost30d: 1 });

    await assertAiBudget(42, deps);
    await flushAsync();
    deps.reader.userRecordedCostSince.mockResolvedValue(
      AI_SPEND_ALERT_THRESHOLD_USD
    );
    await assertAiBudget(42, deps);
    await flushAsync();

    expect(deps.sendAlert).toHaveBeenCalledTimes(1);
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
      props: { server_marker: true },
    });
  });

  it('fails open when the alert email throws', async () => {
    const deps = makeDeps({
      balance: balanceWith(180),
      cost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });
    (deps.sendAlert as Mock).mockRejectedValue(new Error('smtp down'));
    await expect(assertAiBudget(42, deps)).resolves.toBeUndefined();
    await flushAsync();
    expect(deps.sendAlert).toHaveBeenCalled();
  });

  it('does not retry a failed alert email inside seven days, since the event was recorded', async () => {
    const deps = makeDeps({
      balance: balanceWith(180),
      cost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });
    (deps.sendAlert as Mock).mockRejectedValue(new Error('smtp down'));

    await assertAiBudget(42, deps);
    await flushAsync();
    await assertAiBudget(42, deps);
    await flushAsync();

    expect(deps.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('takes over a check whose spend read never settled after five minutes', async () => {
    const deps = makeDeps({
      balance: balanceWith(180),
      cost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });
    deps.reader.userRecordedCostSince.mockReturnValueOnce(
      new Promise(() => undefined)
    );

    await assertAiBudget(42, deps);
    await flushAsync();
    await assertAiBudget(42, deps);
    await flushAsync();
    expect(deps.sendAlert).not.toHaveBeenCalled();

    deps.now = () => new Date(NOW.getTime() + 6 * 60 * 1000);
    await assertAiBudget(42, deps);
    await flushAsync();
    expect(deps.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('still throws and records the exhausted event once while an alert check is held', async () => {
    const deps = makeDeps({
      balance: balanceWith(0),
      cost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => assertAiBudget(42, deps))
    );
    await flushAsync();

    expect(results.map((r) => r.status)).toEqual(Array(5).fill('rejected'));
    for (const result of results) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(
        AiCreditsExhaustedError
      );
    }
    expect(
      trackMock.mock.calls.filter(([name]) => name === 'ai_credits_exhausted')
    ).toHaveLength(1);
    expect(deps.sendAlert).toHaveBeenCalledTimes(1);
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
    (deps.computeBalance as Mock).mockRejectedValue(new Error('db down'));
    await expect(assertAiBudget(42, deps)).resolves.toBeUndefined();
    await flushAsync();
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });
});

describe('withAiBudget', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    trackMock.mockReset();
    resetAiSpendClaims();
    resetInflightReservations();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

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
    const run = vi.fn().mockResolvedValue('ok');
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

    const second = vi.fn().mockResolvedValue('second');
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
      props: { server_marker: true },
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

    const second = vi.fn().mockResolvedValue('second');
    await expect(withAiBudget(42, second, deps)).rejects.toBeInstanceOf(
      AiCreditsExhaustedError
    );
    await flush();
    expect(trackMock).toHaveBeenCalledWith('ai_credits_exhausted', {
      userId: 42,
      props: { server_marker: true },
    });

    release();
    await first;
  });
});

describe('getAiBudgetStatus', () => {
  beforeEach(() => {
    trackMock.mockReset();
    resetAiSpendClaims();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

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
      props: { server_marker: true },
    });
  });

  it('exhausts a free user who spent a grant with no active plan', async () => {
    const grantOnlyBalance: AiCreditBalance = {
      rawCredits: 0,
      credits: 0,
      spent: 250,
      allowance: 0,
      windowStart: new Date('2026-08-20T00:00:00.000Z'),
      windowEnd: new Date('2026-11-18T00:00:00.000Z'),
      resets: 'pass',
    };
    const status = await getAiBudgetStatus(
      42,
      makeDeps({ balance: grantOnlyBalance })
    );
    expect(status.exhausted).toBe(true);
  });

  it('does not re-fire the exhausted event inside the same window', async () => {
    await getAiBudgetStatus(
      42,
      makeDeps({ balance: balanceWith(0), eventCount: 1 })
    );
    await flushAsync();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('fires the exhausted event once when many guards observe zero in the same tick', async () => {
    const deps = makeDeps({ balance: balanceWith(0) });
    await Promise.all(
      Array.from({ length: 100 }, () => getAiBudgetStatus(42, deps))
    );
    await flushAsync();
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(deps.reader.eventCountSince).toHaveBeenCalledTimes(1);
  });

  it('fires once per window: a new allowance window records a new event', async () => {
    await getAiBudgetStatus(42, makeDeps({ balance: balanceWith(0) }));
    const nextWindow: AiCreditBalance = {
      ...balanceWith(0),
      windowStart: new Date('2026-10-01T00:00:00.000Z'),
      windowEnd: new Date('2026-11-01T00:00:00.000Z'),
    };
    await getAiBudgetStatus(42, makeDeps({ balance: nextWindow }));
    await flushAsync();
    expect(trackMock).toHaveBeenCalledTimes(2);
  });

  it('claims once per day for the rolling fallback whose start moves on every call', async () => {
    const rollingStart = (offsetMs: number): AiCreditBalance => ({
      ...balanceWith(0),
      windowStart: new Date(
        new Date('2026-08-08T12:00:00.000Z').getTime() + offsetMs
      ),
      windowEnd: null,
    });
    await Promise.all([
      getAiBudgetStatus(42, makeDeps({ balance: rollingStart(0) })),
      getAiBudgetStatus(42, makeDeps({ balance: rollingStart(40) })),
      getAiBudgetStatus(42, makeDeps({ balance: rollingStart(900) })),
    ]);
    await flushAsync();
    expect(trackMock).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when the ledger read fails so a later observer can record it', async () => {
    const failing = makeDeps({ balance: balanceWith(0) });
    failing.reader.eventCountSince.mockRejectedValueOnce(new Error('db down'));
    await getAiBudgetStatus(42, failing);
    await flushAsync();
    expect(trackMock).not.toHaveBeenCalled();
    await getAiBudgetStatus(42, makeDeps({ balance: balanceWith(0) }));
    await flushAsync();
    expect(trackMock).toHaveBeenCalledTimes(1);
  });
});

function passBalanceWith(rawCredits: number): AiCreditBalance {
  return {
    rawCredits,
    credits: Math.max(0, Math.round(rawCredits)),
    spent: Math.max(0, Math.round(500 - rawCredits)),
    allowance: 500,
    windowStart: new Date('2026-09-01T00:00:00.000Z'),
    windowEnd: new Date('2026-09-08T00:00:00.000Z'),
    resets: 'pass',
  };
}

function makePassDeps(overrides: {
  balance?: AiCreditBalance | null;
  passEventCount?: number;
  passCost30d?: number;
}): AiBudgetDeps & {
  computeAnonymousPassBalance: Mock;
  sendAlert: Mock;
  passReader: {
    anonymousPassRecordedCostSince: Mock;
    anonymousPassEventCountSince: Mock;
  };
} {
  return {
    computeBalance: vi.fn().mockResolvedValue(null),
    computeAnonymousPassBalance: vi
      .fn()
      .mockResolvedValue(overrides.balance ?? null),
    reader: {
      userRecordedCostSince: vi.fn().mockResolvedValue(0),
      eventCountSince: vi.fn().mockResolvedValue(0),
    },
    passReader: {
      anonymousPassCostSince: vi.fn().mockResolvedValue(0),
      anonymousPassRecordedCostSince: vi
        .fn()
        .mockResolvedValue(overrides.passCost30d ?? 0),
      anonymousPassEventCountSince: vi
        .fn()
        .mockResolvedValue(overrides.passEventCount ?? 0),
    },
    sendAlert: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
  };
}

describe('anonymous pass metering', () => {
  beforeEach(() => {
    trackMock.mockReset();
    resetAiSpendClaims();
    resetInflightReservations();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('meters an anonymous pass holder against the pass balance, not the user path', async () => {
    const deps = makePassDeps({ balance: passBalanceWith(400) });
    await assertAiBudget({ anonymousPassId: 7 }, deps);
    expect(deps.computeAnonymousPassBalance).toHaveBeenCalledWith(7, NOW);
    expect(deps.computeBalance).not.toHaveBeenCalled();
  });

  it('runs the call for a pass holder with credits remaining and releases the reservation', async () => {
    const deps = makePassDeps({ balance: passBalanceWith(400) });
    const result = await withAiBudget(
      { anonymousPassId: 7 },
      async () => 'ok',
      deps
    );
    expect(result).toBe('ok');
    expect(reservedCreditsForPass(7)).toBe(0);
  });

  it('throws and fires the exhausted event for a pass holder past their allowance', async () => {
    const deps = makePassDeps({ balance: passBalanceWith(0) });
    await expect(
      assertAiBudget({ anonymousPassId: 7 }, deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
    await flushAsync();
    expect(trackMock).toHaveBeenCalledWith('ai_credits_exhausted', {
      anonymousPassId: 7,
      props: { server_marker: true },
    });
  });

  it('refuses the call without running it when the pass balance is spent', async () => {
    const deps = makePassDeps({ balance: passBalanceWith(0) });
    const run = vi.fn().mockResolvedValue('ok');
    await expect(
      withAiBudget({ anonymousPassId: 7 }, run, deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not re-fire the exhausted event inside the same window for a pass', async () => {
    const deps = makePassDeps({
      balance: passBalanceWith(0),
      passEventCount: 1,
    });
    await expect(
      assertAiBudget({ anonymousPassId: 7 }, deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
    await flushAsync();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('never reads the per-user spend for an anonymous pass', async () => {
    const deps = makePassDeps({ balance: passBalanceWith(400) });
    await assertAiBudget({ anonymousPassId: 7 }, deps);
    await flushAsync();
    expect(deps.sendAlert).not.toHaveBeenCalled();
    expect(deps.reader.userRecordedCostSince).not.toHaveBeenCalled();
    expect(deps.passReader.anonymousPassRecordedCostSince).toHaveBeenCalledWith(
      7,
      new Date('2026-08-08T12:00:00.000Z')
    );
  });

  it('emails the watch alert once when a pass crosses the threshold, refusals included', async () => {
    const deps = makePassDeps({
      balance: passBalanceWith(400),
      passCost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });
    await withAiBudget({ anonymousPassId: 7 }, async () => 'ok', deps);
    await flushAsync();
    expect(trackMock).toHaveBeenCalledWith('ai_spend_alert_sent', {
      anonymousPassId: 7,
      props: { server_marker: true },
    });
    expect(deps.passReader.anonymousPassEventCountSince).toHaveBeenCalledWith(
      'ai_spend_alert_sent',
      7,
      new Date('2026-08-31T12:00:00.000Z')
    );
    expect(deps.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('anonymous pass 7 crossed $25 in 30 days'),
      expect.stringContaining('Anonymous pass 7 is at $25.00')
    );
  });

  it('emails the pass watch alert once when many guards cross the threshold together', async () => {
    const deps = makePassDeps({
      balance: passBalanceWith(400),
      passCost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        withAiBudget({ anonymousPassId: 7 }, async () => 'ok', deps)
      )
    );
    await flushAsync();

    expect(results).toEqual(Array(5).fill('ok'));
    expect(reservedCreditsForPass(7)).toBe(0);
    expect(deps.sendAlert).toHaveBeenCalledTimes(1);
    expect(
      trackMock.mock.calls.filter(([name]) => name === 'ai_spend_alert_sent')
    ).toHaveLength(1);
  });

  it('keeps a pass and a user with the same id apart', async () => {
    const deps = makePassDeps({
      balance: passBalanceWith(400),
      passCost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });
    (deps.computeBalance as Mock).mockResolvedValue(balanceWith(200));
    (deps.reader.userRecordedCostSince as Mock).mockResolvedValue(
      AI_SPEND_ALERT_THRESHOLD_USD
    );

    await assertAiBudget({ anonymousPassId: 7 }, deps);
    await assertAiBudget(7, deps);
    await flushAsync();

    expect(deps.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('dedupes the pass watch alert inside seven days', async () => {
    const deps = makePassDeps({
      balance: passBalanceWith(400),
      passCost30d: AI_SPEND_ALERT_THRESHOLD_USD,
      passEventCount: 1,
    });
    await assertAiBudget({ anonymousPassId: 7 }, deps);
    await flushAsync();
    expect(deps.sendAlert).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('still alerts on a pass that is also exhausted', async () => {
    const deps = makePassDeps({
      balance: passBalanceWith(0),
      passCost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });
    await expect(
      assertAiBudget({ anonymousPassId: 7 }, deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
    await flushAsync();
    expect(deps.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('anonymous pass 7'),
      expect.any(String)
    );
  });

  it('skips a caller with neither a user id nor a pass id', async () => {
    const deps = makePassDeps({ balance: passBalanceWith(0) });
    const status = await getAiBudgetStatus(undefined, deps);
    expect(status).toEqual({ exhausted: false, balance: null });
    expect(deps.computeAnonymousPassBalance).not.toHaveBeenCalled();
    expect(deps.computeBalance).not.toHaveBeenCalled();
  });

  it('fails CLOSED for a pass with no resolvable balance (unknown/expired/non-metered)', async () => {
    const deps = makePassDeps({ balance: null });
    await expect(
      assertAiBudget({ anonymousPassId: 7 }, deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
  });

  it('reports a pass with no resolvable balance as exhausted', async () => {
    const status = await getAiBudgetStatus(
      { anonymousPassId: 7 },
      makePassDeps({ balance: null })
    );
    expect(status).toEqual({ exhausted: true, balance: null });
  });

  it('fails CLOSED for a pass when the balance read throws', async () => {
    const deps = makePassDeps({ balance: passBalanceWith(400) });
    (deps.computeAnonymousPassBalance as Mock).mockRejectedValue(
      new Error('db down')
    );
    await expect(
      assertAiBudget({ anonymousPassId: 7 }, deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
  });

  it('refuses a pass call while the pass balance is fully reserved (matches the signed-in guard)', async () => {
    const deps = makePassDeps({
      balance: passBalanceWith(RESERVED_CREDITS_PER_INFLIGHT_CALL),
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withAiBudget(
      { anonymousPassId: 7 },
      async () => {
        await gate;
        return 'first';
      },
      deps
    );
    await flushAsync();
    expect(reservedCreditsForPass(7)).toBe(RESERVED_CREDITS_PER_INFLIGHT_CALL);

    const second = vi.fn().mockResolvedValue('second');
    await expect(
      withAiBudget({ anonymousPassId: 7 }, second, deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
    expect(second).not.toHaveBeenCalled();

    release();
    await expect(first).resolves.toBe('first');
    expect(reservedCreditsForPass(7)).toBe(0);
  });

  it('keeps the signed-in path failing OPEN on a null balance', async () => {
    const deps = makePassDeps({ balance: null });
    const status = await getAiBudgetStatus(42, deps);
    expect(status).toEqual({ exhausted: false, balance: null });
  });
});

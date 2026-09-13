import {
  AI_SPEND_ALERT_THRESHOLD_USD,
  AiBudgetDeps,
  AiCreditsExhaustedError,
  assertAiBudget,
  getAiBudgetStatus,
  hasAiCreditsForConversion,
} from './aiSpendGuard';
import { AiCreditBalance } from './aiCredits/balance';
import { track } from '../../services/events/track';

jest.mock('../../services/events/track', () => ({ track: jest.fn() }));

const trackMock = track as jest.Mock;
const NOW = new Date('2026-09-07T12:00:00.000Z');

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
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('emails the watch alert once when 30d spend crosses the threshold', async () => {
    const deps = makeDeps({
      balance: balanceWith(180),
      cost30d: AI_SPEND_ALERT_THRESHOLD_USD,
    });
    await assertAiBudget(42, deps);
    expect(trackMock).toHaveBeenCalledWith('ai_spend_alert_sent', {
      userId: 42,
      props: {},
    });
    expect(deps.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('crossed $25 in 30 days'),
      expect.stringContaining('User 42')
    );
  });

  it('fails open when the balance read throws', async () => {
    const deps = makeDeps({});
    (deps.computeBalance as jest.Mock).mockRejectedValue(new Error('db down'));
    await expect(assertAiBudget(42, deps)).resolves.toBeUndefined();
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });
});

describe('hasAiCreditsForConversion', () => {
  it('allows a conversion the remaining balance can cover', async () => {
    const deps = makeDeps({ balance: balanceWith(180) });
    expect(await hasAiCreditsForConversion(42, 1000, deps)).toBe(true);
  });

  it('blocks a conversion whose estimate exceeds the remaining balance', async () => {
    const deps = makeDeps({ balance: balanceWith(1) });
    const hugeBytes = 500 * 1024 * 1024;
    expect(await hasAiCreditsForConversion(42, hugeBytes, deps)).toBe(false);
  });

  it('allows anonymous callers (the AI gate governs access)', async () => {
    const deps = makeDeps({});
    expect(await hasAiCreditsForConversion(null, 1000, deps)).toBe(true);
  });

  it('fails open when the balance read throws', async () => {
    const deps = makeDeps({});
    (deps.computeBalance as jest.Mock).mockRejectedValue(new Error('db down'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await hasAiCreditsForConversion(42, 1000, deps)).toBe(true);
  });
});

describe('getAiBudgetStatus', () => {
  it('returns not-exhausted with a null balance for anonymous callers', async () => {
    const status = await getAiBudgetStatus(null, undefined, makeDeps({}));
    expect(status).toEqual({ exhausted: false, balance: null });
  });
});

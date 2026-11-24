import { vi, type Mock } from 'vitest';
import {
  AiBudgetDeps,
  AiCreditsExhaustedError,
  assertAiBudget,
  getAiBudgetStatus,
  resetAiSpendClaims,
  withAiBudget,
} from './aiSpendGuard';
import { AiCreditBalance } from './aiCredits/balance';
import { AiGiftBalance } from './aiCredits/gift/giftBalance';
import { currentGiftId } from './aiCredits/gift/giftFunding';
import {
  RESERVED_CREDITS_PER_INFLIGHT_CALL,
  reservedCreditsFor,
  reservedGiftCreditsFor,
  resetInflightReservations,
} from './aiCredits/inflightReservations';
import { track } from '../../services/events/track';

vi.mock('../../services/events/track', () => ({ track: vi.fn() }));

const trackMock = track as Mock;
const NOW = new Date('2026-11-25T12:00:00.000Z');
const USER = 41;
const GIFT_ID = 9;

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

function planBalance(rawCredits: number): AiCreditBalance {
  return {
    rawCredits,
    credits: Math.max(0, Math.round(rawCredits)),
    spent: Math.max(0, Math.round(300 - rawCredits)),
    allowance: 300,
    windowStart: new Date('2026-11-01T00:00:00.000Z'),
    windowEnd: new Date('2026-12-01T00:00:00.000Z'),
    resets: 'period',
  };
}

function giftBalance(credits: number): AiGiftBalance {
  return {
    giftId: GIFT_ID,
    credits,
    rawCredits: credits,
    spent: 100 - credits,
    claimedAt: new Date('2026-11-25T10:00:00.000Z'),
    expiresAt: new Date('2026-11-27T10:00:00.000Z'),
  };
}

function makeDeps(overrides: {
  plan?: AiCreditBalance | null;
  gift?: AiGiftBalance | null;
  giftError?: Error;
}): AiBudgetDeps & { computeGiftBalance: Mock; computeBalance: Mock } {
  const computeGiftBalance =
    overrides.giftError == null
      ? vi.fn().mockResolvedValue(overrides.gift ?? null)
      : vi.fn().mockRejectedValue(overrides.giftError);
  return {
    computeBalance: vi.fn().mockResolvedValue(overrides.plan ?? null),
    computeGiftBalance,
    reader: {
      userRecordedCostSince: vi.fn().mockResolvedValue(0),
      eventCountSince: vi.fn().mockResolvedValue(0),
    },
    sendAlert: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
  };
}

beforeEach(() => {
  resetAiSpendClaims();
  resetInflightReservations();
  trackMock.mockClear();
});

describe('withAiBudget and the gift', () => {
  it('runs a free account on its gift and stamps the gift on the call', async () => {
    const deps = makeDeps({ plan: null, gift: giftBalance(100) });
    const run = vi.fn(async () => currentGiftId());

    const fundedBy = await withAiBudget(
      { userId: USER, aiGift: 'only' },
      run,
      deps
    );

    expect(fundedBy).toBe(GIFT_ID);
    expect(reservedGiftCreditsFor(GIFT_ID)).toBe(0);
  });

  it('never reads the plan balance for a free account on the gift', async () => {
    const deps = makeDeps({ plan: planBalance(250), gift: giftBalance(100) });

    await withAiBudget(
      { userId: USER, aiGift: 'only' },
      async () => currentGiftId(),
      deps
    );

    expect(deps.computeBalance).not.toHaveBeenCalled();
  });

  it('refuses a free account whose gift has expired, without running the call', async () => {
    const deps = makeDeps({ plan: null, gift: null });
    const run = vi.fn();

    await expect(
      withAiBudget({ userId: USER, aiGift: 'only' }, run, deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a free account whose gift is spent', async () => {
    const deps = makeDeps({ plan: null, gift: giftBalance(0) });
    const run = vi.fn();

    await expect(
      withAiBudget({ userId: USER, aiGift: 'only' }, run, deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed for a free account when the gift read throws', async () => {
    const deps = makeDeps({ giftError: new Error('db down') });
    const run = vi.fn();

    await expect(
      withAiBudget({ userId: USER, aiGift: 'only' }, run, deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
    expect(run).not.toHaveBeenCalled();
  });

  it('spends a paying account on its plan while plan credits remain', async () => {
    const deps = makeDeps({ plan: planBalance(120), gift: giftBalance(100) });

    const fundedBy = await withAiBudget(
      { userId: USER, aiGift: 'fallback' },
      async () => currentGiftId(),
      deps
    );

    expect(fundedBy).toBeNull();
    expect(deps.computeGiftBalance).not.toHaveBeenCalled();
  });

  it('draws a paying account on the gift once its plan credits run out', async () => {
    const deps = makeDeps({ plan: planBalance(0), gift: giftBalance(100) });

    const fundedBy = await withAiBudget(
      { userId: USER, aiGift: 'fallback' },
      async () => currentGiftId(),
      deps
    );

    expect(fundedBy).toBe(GIFT_ID);
    expect(reservedCreditsFor(USER)).toBe(0);
  });

  it('stops a paying account whose plan and gift are both spent', async () => {
    const deps = makeDeps({ plan: planBalance(0), gift: giftBalance(0) });
    const run = vi.fn();

    await expect(
      withAiBudget({ userId: USER, aiGift: 'fallback' }, run, deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
    expect(run).not.toHaveBeenCalled();
  });

  it('stops a paying account at zero when its gift expired', async () => {
    const deps = makeDeps({ plan: planBalance(0), gift: null });

    await expect(
      withAiBudget({ userId: USER, aiGift: 'fallback' }, vi.fn(), deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
  });

  it('never offers the gift to a surface that did not ask for it', async () => {
    const deps = makeDeps({ plan: planBalance(0), gift: giftBalance(100) });

    await expect(
      withAiBudget(USER, vi.fn(), deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
    expect(deps.computeGiftBalance).not.toHaveBeenCalled();
  });

  it('bounds calls in flight on the gift by the same reservation as a plan', async () => {
    const deps = makeDeps({ gift: giftBalance(15) });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withAiBudget(
      { userId: USER, aiGift: 'only' },
      () => held,
      deps
    );
    await flushAsync();
    const second = withAiBudget(
      { userId: USER, aiGift: 'only' },
      () => held,
      deps
    );
    await flushAsync();
    expect(reservedGiftCreditsFor(GIFT_ID)).toBe(
      2 * RESERVED_CREDITS_PER_INFLIGHT_CALL
    );

    await expect(
      withAiBudget({ userId: USER, aiGift: 'only' }, vi.fn(), deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);

    release();
    await Promise.all([first, second]);
    expect(reservedGiftCreditsFor(GIFT_ID)).toBe(0);
  });

  it('records the first AI use on the gift once', async () => {
    const deps = makeDeps({ gift: giftBalance(100) });

    await withAiBudget({ userId: USER, aiGift: 'only' }, async () => 1, deps);
    await withAiBudget({ userId: USER, aiGift: 'only' }, async () => 1, deps);

    const firstUse = trackMock.mock.calls.filter(
      ([name]) => name === 'ai_gift_first_use'
    );
    expect(firstUse).toEqual([
      [
        'ai_gift_first_use',
        expect.objectContaining({
          userId: USER,
          props: expect.objectContaining({ gift_id: GIFT_ID, mode: 'only' }),
        }),
      ],
    ]);
  });
});

describe('assertAiBudget and the gift', () => {
  it('passes a free account with gift credits', async () => {
    const deps = makeDeps({ gift: giftBalance(40) });

    await expect(
      assertAiBudget({ userId: USER, aiGift: 'only' }, deps)
    ).resolves.toBeUndefined();
  });

  it('stops a free account without gift credits', async () => {
    const deps = makeDeps({ gift: null });

    await expect(
      assertAiBudget({ userId: USER, aiGift: 'only' }, deps)
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
  });

  it('passes a paying account at zero that still has gift credits', async () => {
    const deps = makeDeps({ plan: planBalance(0), gift: giftBalance(40) });

    await expect(
      assertAiBudget({ userId: USER, aiGift: 'fallback' }, deps)
    ).resolves.toBeUndefined();
  });
});

describe('getAiBudgetStatus and the gift', () => {
  it('reports a free account with gift credits as able to convert', async () => {
    const deps = makeDeps({ gift: giftBalance(40) });

    const status = await getAiBudgetStatus(
      { userId: USER, aiGift: 'only' },
      deps
    );

    expect(status.exhausted).toBe(false);
  });

  it('reports a free account with a spent gift as exhausted, so the parser builds the deck', async () => {
    const deps = makeDeps({ gift: giftBalance(0) });

    const status = await getAiBudgetStatus(
      { userId: USER, aiGift: 'only' },
      deps
    );

    expect(status).toEqual({ exhausted: true, balance: null });
  });

  it('reports a paying account at zero with gift credits as able to convert', async () => {
    const deps = makeDeps({ plan: planBalance(0), gift: giftBalance(40) });

    const status = await getAiBudgetStatus(
      { userId: USER, aiGift: 'fallback' },
      deps
    );

    expect(status.exhausted).toBe(false);
  });

  it('keeps a paying account at zero exhausted when the gift is gone', async () => {
    const deps = makeDeps({ plan: planBalance(0), gift: null });

    const status = await getAiBudgetStatus(
      { userId: USER, aiGift: 'fallback' },
      deps
    );

    expect(status.exhausted).toBe(true);
    expect(status.balance?.credits).toBe(0);
  });

  it('answers exactly as before for a paying account when no gift is involved', async () => {
    const withMode = await getAiBudgetStatus(
      { userId: USER, aiGift: 'fallback' },
      makeDeps({ plan: planBalance(120), gift: null })
    );
    const without = await getAiBudgetStatus(
      USER,
      makeDeps({ plan: planBalance(120), gift: null })
    );

    expect(withMode).toEqual(without);
  });
});

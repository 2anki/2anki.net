import {
  computeAiCreditBalance,
  AiCreditBalanceReaders,
  GrantWindow,
} from './balance';
import { PlanInputs } from './allowance';

const NOW = new Date('2026-05-12T12:00:00.000Z');

function readersFor(
  inputs: PlanInputs | null,
  spendUsd: number,
  grantCredits = 0,
  grantWindow: GrantWindow | null = null
): AiCreditBalanceReaders {
  return {
    getPlanInputs: async () => inputs,
    sumActiveCredits: async () => grantCredits,
    activeGrantWindow: async () => grantWindow,
    userCostSince: async () => spendUsd,
  };
}

const subscriberInputs: PlanInputs = {
  passes: [],
  subscriptions: [
    {
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      periodEnd: new Date('2026-06-01T00:00:00.000Z'),
      unitAmount: 799,
    },
  ],
  patreon: false,
  ankifyAccess: false,
};

describe('computeAiCreditBalance', () => {
  it('returns null when the user has no allowance', async () => {
    const result = await computeAiCreditBalance(1, NOW, readersFor(null, 0));
    expect(result).toBeNull();
  });

  it('subtracts recorded spend (in cents) from the allowance', async () => {
    const result = await computeAiCreditBalance(
      1,
      NOW,
      readersFor(subscriberInputs, 1.2)
    );
    expect(result?.allowance).toBe(300);
    expect(result?.credits).toBe(180);
    expect(result?.rawCredits).toBeCloseTo(180);
    expect(result?.resets).toBe('period');
  });

  it('reports spend converted to whole credits used', async () => {
    const result = await computeAiCreditBalance(
      1,
      NOW,
      readersFor(subscriberInputs, 1.2)
    );
    expect(result?.spent).toBe(120);
  });

  it('floors reported spend at zero when nothing was spent', async () => {
    const result = await computeAiCreditBalance(
      1,
      NOW,
      readersFor(subscriberInputs, 0)
    );
    expect(result?.spent).toBe(0);
  });

  it('adds unexpired grant credits to the balance', async () => {
    const result = await computeAiCreditBalance(
      1,
      NOW,
      readersFor(subscriberInputs, 1.2, 250)
    );
    expect(result?.credits).toBe(430);
  });

  it('never reports a negative displayed balance', async () => {
    const result = await computeAiCreditBalance(
      1,
      NOW,
      readersFor(subscriberInputs, 9)
    );
    expect(result?.rawCredits).toBeLessThan(0);
    expect(result?.credits).toBe(0);
  });
});

describe('computeAiCreditBalance with no active plan', () => {
  const lapsedInputs: PlanInputs = {
    passes: [],
    subscriptions: [],
    patreon: false,
    ankifyAccess: false,
  };
  const grantWindow: GrantWindow = {
    windowStart: new Date('2026-04-20T00:00:00.000Z'),
    windowEnd: new Date('2026-07-19T00:00:00.000Z'),
  };

  it('returns null for an unknown user even with a grant sum', async () => {
    const result = await computeAiCreditBalance(
      1,
      NOW,
      readersFor(null, 1, 250, grantWindow)
    );
    expect(result).toBeNull();
  });

  it('returns null when the plan lapsed and no grant is active', async () => {
    const result = await computeAiCreditBalance(
      1,
      NOW,
      readersFor(lapsedInputs, 0, 0, grantWindow)
    );
    expect(result).toBeNull();
  });

  it('returns a grant-only balance when a pack is active without a plan', async () => {
    const result = await computeAiCreditBalance(
      1,
      NOW,
      readersFor(lapsedInputs, 1, 250, grantWindow)
    );
    expect(result).not.toBeNull();
    expect(result?.allowance).toBe(0);
    expect(result?.credits).toBe(150);
    expect(result?.spent).toBe(100);
    expect(result?.windowStart).toEqual(grantWindow.windowStart);
    expect(result?.windowEnd).toEqual(grantWindow.windowEnd);
    expect(result?.resets).toBe('pass');
  });

  it('returns null when a positive grant sum resolves no window', async () => {
    const result = await computeAiCreditBalance(
      1,
      NOW,
      readersFor(lapsedInputs, 0, 250, null)
    );
    expect(result).toBeNull();
  });

  it('counts spend against the grant window start', async () => {
    const userCostSince = jest.fn().mockResolvedValue(0);
    const readers: AiCreditBalanceReaders = {
      getPlanInputs: async () => lapsedInputs,
      sumActiveCredits: async () => 250,
      activeGrantWindow: async () => grantWindow,
      userCostSince,
    };
    await computeAiCreditBalance(7, NOW, readers);
    expect(userCostSince).toHaveBeenCalledWith(7, grantWindow.windowStart);
  });

  it('reads a fully-spent grant as a zero balance, not null', async () => {
    const result = await computeAiCreditBalance(
      1,
      NOW,
      readersFor(lapsedInputs, 2.5, 250, grantWindow)
    );
    expect(result).not.toBeNull();
    expect(result?.credits).toBe(0);
    expect(result?.allowance).toBe(0);
  });
});

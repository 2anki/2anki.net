import { computeAiCreditBalance, AiCreditBalanceReaders } from './balance';
import { PlanInputs } from './allowance';

const NOW = new Date('2026-05-12T12:00:00.000Z');

function readersFor(
  inputs: PlanInputs | null,
  spendUsd: number,
  grantCredits = 0
): AiCreditBalanceReaders {
  return {
    getPlanInputs: async () => inputs,
    sumActiveCredits: async () => grantCredits,
    userCostSince: async () => spendUsd,
  };
}

const subscriberInputs: PlanInputs = {
  passes: [],
  subscription: {
    periodStart: new Date('2026-05-01T00:00:00.000Z'),
    periodEnd: new Date('2026-06-01T00:00:00.000Z'),
    unitAmount: 799,
  },
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

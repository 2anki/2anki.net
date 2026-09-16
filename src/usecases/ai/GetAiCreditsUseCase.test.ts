import { GetAiCreditsUseCase } from './GetAiCreditsUseCase';
import { AiCreditBalanceReaders } from '../../lib/claude/aiCredits/balance';
import { PlanInputs } from '../../lib/claude/aiCredits/allowance';

const NOW = new Date('2026-05-12T12:00:00.000Z');

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

function readers(
  inputs: PlanInputs | null,
  spendUsd = 0,
  grantCredits = 0,
  grantWindow: { windowStart: Date; windowEnd: Date } | null = null
): AiCreditBalanceReaders {
  return {
    getPlanInputs: async () => inputs,
    sumActiveCredits: async () => grantCredits,
    activeGrantWindow: async () => grantWindow,
    userCostSince: async () => spendUsd,
  };
}

describe('GetAiCreditsUseCase', () => {
  it('maps a live balance to the typed response with an ISO window end', async () => {
    const useCase = new GetAiCreditsUseCase(readers(subscriberInputs, 1.2));
    const result = await useCase.execute(42, NOW);
    expect(result).toEqual({
      credits: 180,
      used: 120,
      allowance: 300,
      usable: true,
      windowEnd: '2026-06-01T00:00:00.000Z',
      resets: 'period',
    });
  });

  it('serializes a null window end for a rolling (period-less) subscription', async () => {
    const rollingInputs: PlanInputs = {
      passes: [],
      subscriptions: [
        {
          periodStart: null,
          periodEnd: null,
          unitAmount: 799,
        },
      ],
      patreon: false,
      ankifyAccess: false,
    };
    const useCase = new GetAiCreditsUseCase(readers(rollingInputs));
    const result = await useCase.execute(42, NOW);
    expect(result.windowEnd).toBeNull();
    expect(result.credits).toBe(300);
  });

  it('returns an empty allowance for a user with no plan', async () => {
    const useCase = new GetAiCreditsUseCase(readers(null));
    const result = await useCase.execute(42, NOW);
    expect(result).toEqual({
      credits: 0,
      used: 0,
      allowance: 0,
      usable: false,
      windowEnd: null,
      resets: 'month',
    });
  });

  it('marks a grant-only balance not usable while the plan is lapsed', async () => {
    const lapsedInputs: PlanInputs = {
      passes: [],
      subscriptions: [],
      patreon: false,
      ankifyAccess: false,
    };
    const grantWindow = {
      windowStart: new Date('2026-04-20T00:00:00.000Z'),
      windowEnd: new Date('2026-07-19T00:00:00.000Z'),
    };
    const useCase = new GetAiCreditsUseCase(
      readers(lapsedInputs, 1, 250, grantWindow)
    );
    const result = await useCase.execute(42, NOW);
    expect(result).toEqual({
      credits: 150,
      used: 100,
      allowance: 0,
      usable: false,
      windowEnd: '2026-07-19T00:00:00.000Z',
      resets: 'pass',
    });
  });
});

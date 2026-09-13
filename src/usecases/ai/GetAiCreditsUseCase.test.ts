import { GetAiCreditsUseCase } from './GetAiCreditsUseCase';
import { AiCreditBalanceReaders } from '../../lib/claude/aiCredits/balance';
import { PlanInputs } from '../../lib/claude/aiCredits/allowance';

const NOW = new Date('2026-05-12T12:00:00.000Z');

const subscriberInputs: PlanInputs = {
  pass: null,
  subscription: {
    active: true,
    periodStart: new Date('2026-05-01T00:00:00.000Z'),
    periodEnd: new Date('2026-06-01T00:00:00.000Z'),
    unitAmount: 799,
  },
  patreon: false,
  ankifyAccess: false,
};

function readers(
  inputs: PlanInputs | null,
  spendUsd = 0
): AiCreditBalanceReaders {
  return {
    getPlanInputs: async () => inputs,
    sumActiveCredits: async () => 0,
    userCostSince: async () => spendUsd,
  };
}

describe('GetAiCreditsUseCase', () => {
  it('maps a live balance to the typed response with an ISO window end', async () => {
    const useCase = new GetAiCreditsUseCase(readers(subscriberInputs, 1.2));
    const result = await useCase.execute(42, NOW);
    expect(result).toEqual({
      credits: 180,
      allowance: 300,
      windowEnd: '2026-06-01T00:00:00.000Z',
      resets: 'period',
    });
  });

  it('returns an empty allowance for a user with no plan', async () => {
    const useCase = new GetAiCreditsUseCase(readers(null));
    const result = await useCase.execute(42, NOW);
    expect(result).toEqual({
      credits: 0,
      allowance: 0,
      windowEnd: null,
      resets: 'month',
    });
  });
});

import { createAiCreditReaders } from './createAiCreditReaders';
import { AiCreditsRepository } from './AiCreditsRepository';
import { AiCreditGrantsRepository } from './AiCreditGrantsRepository';
import { AiUsageMetricsRepository } from './AiUsageMetricsRepository';
import type { Knex } from 'knex';

const fakeDb = {} as Knex;
const NOW = new Date('2026-05-12T00:00:00.000Z');

describe('createAiCreditReaders', () => {
  afterEach(() => jest.restoreAllMocks());

  it('wires getPlanInputs to the plan repository', async () => {
    const spy = jest
      .spyOn(AiCreditsRepository.prototype, 'getPlanInputs')
      .mockResolvedValue(null);

    await createAiCreditReaders(fakeDb).getPlanInputs(42, NOW);

    expect(spy).toHaveBeenCalledWith(42, NOW);
  });

  it('wires sumActiveCredits to the grants repository', async () => {
    const spy = jest
      .spyOn(AiCreditGrantsRepository.prototype, 'sumActiveCredits')
      .mockResolvedValue(150);

    const total = await createAiCreditReaders(fakeDb).sumActiveCredits(42, NOW);

    expect(spy).toHaveBeenCalledWith(42, NOW);
    expect(total).toBe(150);
  });

  it('wires userCostSince to the usage repository', async () => {
    const spy = jest
      .spyOn(AiUsageMetricsRepository.prototype, 'userCostSince')
      .mockResolvedValue(1.25);

    const spend = await createAiCreditReaders(fakeDb).userCostSince(42, NOW);

    expect(spy).toHaveBeenCalledWith(42, NOW);
    expect(spend).toBe(1.25);
  });
});

import { vi } from 'vitest';
import {
  CheckMonthlyPrintLimitUseCase,
  MONTHLY_PRINT_LIMIT,
  MonthlyPrintLimitError,
} from './CheckMonthlyPrintLimitUseCase';
import UsersRepository from '../../data_layer/UsersRepository';

function buildRepo(prints_used: number): UsersRepository {
  return {
    getPrintUsage: vi
      .fn()
      .mockResolvedValue({ prints_used, month_started_at: new Date() }),
  } as unknown as UsersRepository;
}

describe('CheckMonthlyPrintLimitUseCase', () => {
  it('passes when free user has not used their print this month', async () => {
    const useCase = new CheckMonthlyPrintLimitUseCase(buildRepo(0));
    await expect(
      useCase.execute({ userId: '1', isPaying: false })
    ).resolves.toBeUndefined();
  });

  it('throws MonthlyPrintLimitError when free user has used their print', async () => {
    const useCase = new CheckMonthlyPrintLimitUseCase(buildRepo(1));
    await expect(
      useCase.execute({ userId: '1', isPaying: false })
    ).rejects.toBeInstanceOf(MonthlyPrintLimitError);
  });

  it('skips the check entirely for paying users even when over limit', async () => {
    const repo = buildRepo(50);
    const useCase = new CheckMonthlyPrintLimitUseCase(repo);
    await expect(
      useCase.execute({ userId: '1', isPaying: true })
    ).resolves.toBeUndefined();
    expect(repo.getPrintUsage).not.toHaveBeenCalled();
  });

  it('exposes used, limit, and reset_on on the thrown error', async () => {
    const useCase = new CheckMonthlyPrintLimitUseCase(buildRepo(1));
    try {
      await useCase.execute({ userId: '1', isPaying: false });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MonthlyPrintLimitError);
      const err = error as MonthlyPrintLimitError;
      expect(err.prints_used).toBe(1);
      expect(err.limit).toBe(MONTHLY_PRINT_LIMIT);
      expect(err.reset_on).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});

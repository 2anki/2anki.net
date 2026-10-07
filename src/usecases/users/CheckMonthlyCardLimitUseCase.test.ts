import { vi } from 'vitest';
import knex, { Knex } from 'knex';

import {
  CheckMonthlyCardLimitUseCase,
  MONTHLY_CARD_LIMIT,
  MonthlyLimitError,
} from './CheckMonthlyCardLimitUseCase';
import UsersRepository from '../../data_layer/UsersRepository';

function buildRepo(cards_used: number): UsersRepository {
  return {
    getCardUsage: vi
      .fn()
      .mockResolvedValue({ cards_used, month_started_at: new Date() }),
  } as unknown as UsersRepository;
}

describe('CheckMonthlyCardLimitUseCase', () => {
  it('passes when free user has capacity remaining', async () => {
    const useCase = new CheckMonthlyCardLimitUseCase(buildRepo(50));
    await expect(
      useCase.execute({
        userId: '1',
        candidateCardCount: 30,
        isPaying: false,
      })
    ).resolves.toBeUndefined();
  });

  it('throws when free user would exceed the limit', async () => {
    const useCase = new CheckMonthlyCardLimitUseCase(buildRepo(80));
    await expect(
      useCase.execute({
        userId: '1',
        candidateCardCount: 30,
        isPaying: false,
      })
    ).rejects.toBeInstanceOf(MonthlyLimitError);
  });

  it('enforces the limit regardless of the date — the June gate is gone', async () => {
    const useCase = new CheckMonthlyCardLimitUseCase(buildRepo(80));
    await expect(
      useCase.execute({
        userId: '1',
        candidateCardCount: 30,
        isPaying: false,
        now: new Date(Date.UTC(2020, 0, 1)),
      })
    ).rejects.toBeInstanceOf(MonthlyLimitError);
  });

  it('skips the check entirely for paying users', async () => {
    const repo = buildRepo(500);
    const useCase = new CheckMonthlyCardLimitUseCase(repo);
    await expect(
      useCase.execute({
        userId: '1',
        candidateCardCount: 200,
        isPaying: true,
      })
    ).resolves.toBeUndefined();
    expect(repo.getCardUsage).not.toHaveBeenCalled();
  });

  it('exposes used, limit, candidate, and reset_on on the thrown error', async () => {
    const useCase = new CheckMonthlyCardLimitUseCase(buildRepo(95));
    try {
      await useCase.execute({
        userId: '1',
        candidateCardCount: 10,
        isPaying: false,
      });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MonthlyLimitError);
      const err = error as MonthlyLimitError;
      expect(err.cards_used).toBe(95);
      expect(err.limit).toBe(MONTHLY_CARD_LIMIT);
      expect(err.candidate).toBe(10);
      expect(err.reset_on).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});

describe('CheckMonthlyCardLimitUseCase with a real repository (sqlite)', () => {
  let db: Knex;
  let repo: UsersRepository;
  let useCase: CheckMonthlyCardLimitUseCase;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('users', (t) => {
      t.increments('id');
      t.string('email');
      t.integer('cards_used_this_month').notNullable().defaultTo(0);
      t.timestamp('cards_month_started_at');
    });
    repo = new UsersRepository(db);
    useCase = new CheckMonthlyCardLimitUseCase(repo);
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function insertUserWithStaleMonth(cardsUsed: number): Promise<number> {
    const now = new Date();
    const previousMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)
    );
    const [id] = await db('users').insert({
      email: 'rollover@example.com',
      cards_used_this_month: cardsUsed,
      cards_month_started_at: previousMonth,
    });
    return id;
  }

  it('allows a free user with a huge stale counter once the month rolls over', async () => {
    const userId = await insertUserWithStaleMonth(554);

    await expect(
      useCase.execute({ userId, candidateCardCount: 90, isPaying: false })
    ).resolves.toBeUndefined();
  });

  it('blocks the same user after incrementing past the limit in the new month', async () => {
    const userId = await insertUserWithStaleMonth(554);

    await useCase.execute({ userId, candidateCardCount: 90, isPaying: false });
    await repo.incrementCardUsage(userId, 90);

    await expect(
      useCase.execute({ userId, candidateCardCount: 20, isPaying: false })
    ).rejects.toBeInstanceOf(MonthlyLimitError);
  });
});

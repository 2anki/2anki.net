import UsersRepository from '../../data_layer/UsersRepository';
import { startOfNextMonthUtc } from '../../lib/User/startOfMonthUtc';

export const MONTHLY_CARD_LIMIT = 100;

export const ANONYMOUS_CARD_CAP = 21;

export class AnonymousCardCapError extends Error {
  constructor(
    public readonly cardsFound: number,
    public readonly cap: number
  ) {
    super(`Anonymous conversion produced ${cardsFound} cards; cap is ${cap}`);
    this.name = 'AnonymousCardCapError';
  }
}

export class MonthlyLimitError extends Error {
  constructor(
    public readonly cards_used: number,
    public readonly limit: number,
    public readonly candidate: number,
    public readonly reset_on: string
  ) {
    super(
      `Monthly card limit reached (${cards_used}/${limit}); job would add ${candidate}`
    );
    this.name = 'MonthlyLimitError';
  }
}

interface CheckArgs {
  userId: string | number;
  candidateCardCount: number;
  isPaying: boolean;
  now?: Date;
}

export class CheckMonthlyCardLimitUseCase {
  constructor(private readonly userRepository: UsersRepository) {}

  async execute({
    userId,
    candidateCardCount,
    isPaying,
    now = new Date(),
  }: CheckArgs): Promise<void> {
    if (isPaying) return;
    if (candidateCardCount <= 0) return;

    const { cards_used } = await this.userRepository.getCardUsage(userId);
    if (cards_used + candidateCardCount > MONTHLY_CARD_LIMIT) {
      throw new MonthlyLimitError(
        cards_used,
        MONTHLY_CARD_LIMIT,
        candidateCardCount,
        startOfNextMonthUtc(now).toISOString()
      );
    }
  }
}

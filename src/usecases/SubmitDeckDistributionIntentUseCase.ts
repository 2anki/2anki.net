import type { IDeckDistributionIntentRepository } from '../data_layer/DeckDistributionIntentRepository';
import type { DeckDistributionAnswer } from '../lib/deckDistribution/answers';

export interface DeckDistributionIntentInput {
  userId: number;
  answer: DeckDistributionAnswer;
  uploadKey: string;
  notifyEmail?: string | null;
}

export class SubmitDeckDistributionIntentUseCase {
  constructor(private readonly repo: IDeckDistributionIntentRepository) {}

  async execute(input: DeckDistributionIntentInput): Promise<void> {
    await this.repo.record({
      user_id: input.userId,
      answer: input.answer,
      upload_key: input.uploadKey,
      notify_email: input.notifyEmail ?? null,
    });
  }
}

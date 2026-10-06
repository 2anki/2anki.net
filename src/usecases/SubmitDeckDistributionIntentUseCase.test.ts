import { SubmitDeckDistributionIntentUseCase } from './SubmitDeckDistributionIntentUseCase';
import { InMemoryDeckDistributionIntentRepository } from '../data_layer/DeckDistributionIntentRepository';

describe('SubmitDeckDistributionIntentUseCase', () => {
  it('records the mapped entry with a null email when none is given', async () => {
    const repo = new InMemoryDeckDistributionIntentRepository();
    const useCase = new SubmitDeckDistributionIntentUseCase(repo);

    await useCase.execute({
      userId: 7,
      answer: 'colleagues',
      uploadKey: 'deck-7.apkg',
    });

    expect(repo.all()).toEqual([
      {
        user_id: 7,
        answer: 'colleagues',
        upload_key: 'deck-7.apkg',
        notify_email: null,
      },
    ]);
  });

  it('persists the notify email when provided', async () => {
    const repo = new InMemoryDeckDistributionIntentRepository();
    const useCase = new SubmitDeckDistributionIntentUseCase(repo);

    await useCase.execute({
      userId: 9,
      answer: 'students',
      uploadKey: 'deck-9.apkg',
      notifyEmail: 'me@example.com',
    });

    expect(repo.all()[0].notify_email).toBe('me@example.com');
  });
});

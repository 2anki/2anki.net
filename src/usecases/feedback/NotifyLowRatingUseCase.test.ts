import { vi } from 'vitest';

import { InMemoryEmojiFeedbackRepository } from '../../data_layer/EmojiFeedbackRepository';
import type {
  ILowRatingContextRepository,
  LowRatingContext,
} from '../../data_layer/LowRatingContextRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import { NotifyLowRatingUseCase } from './NotifyLowRatingUseCase';

const context: LowRatingContext = {
  userId: '21770',
  latestJobId: 918,
  latestJobStatus: 'failed',
  plan: 'subscriber',
};

function build() {
  const feedbackRepository = new InMemoryEmojiFeedbackRepository();
  const getByEmail = vi.fn().mockResolvedValue(context);
  const contextRepository: ILowRatingContextRepository = { getByEmail };
  const sendLowRatingFeedbackEmail = vi.fn().mockResolvedValue(undefined);
  const emailService = {
    sendLowRatingFeedbackEmail,
  } as unknown as IEmailService;
  const useCase = new NotifyLowRatingUseCase(
    feedbackRepository,
    contextRepository,
    emailService
  );
  return {
    feedbackRepository,
    getByEmail,
    sendLowRatingFeedbackEmail,
    useCase,
  };
}

describe('NotifyLowRatingUseCase', () => {
  const now = new Date('2026-10-19T12:00:00.000Z');

  it('does not email a satisfied rating even with an email', async () => {
    const { useCase, sendLowRatingFeedbackEmail } = build();
    await useCase.notifyIfLowRating({
      rating: 5,
      comment: 'love it',
      page: '/upload',
      email: 'learner@example.com',
      now,
    });
    expect(sendLowRatingFeedbackEmail).not.toHaveBeenCalled();
  });

  it('does not email a low rating that left no email', async () => {
    const { useCase, sendLowRatingFeedbackEmail } = build();
    await useCase.notifyIfLowRating({
      rating: 1,
      comment: 'broken',
      page: '/upload',
      email: null,
      now,
    });
    expect(sendLowRatingFeedbackEmail).not.toHaveBeenCalled();
  });

  it('emails support once with the reply-to and enrichment for a low rating', async () => {
    const { useCase, feedbackRepository, sendLowRatingFeedbackEmail } = build();
    await feedbackRepository.insert({
      rating: 2,
      comment: 'cards came out wrong',
      page: '/upload',
      email: 'learner@example.com',
    });

    await useCase.notifyIfLowRating({
      rating: 2,
      comment: 'cards came out wrong',
      page: '/upload',
      email: 'learner@example.com',
      now,
    });

    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledTimes(1);
    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledWith({
      rating: 2,
      comment: 'cards came out wrong',
      page: '/upload',
      replyTo: 'learner@example.com',
      userId: '21770',
      latestJobId: 918,
      latestJobStatus: 'failed',
      plan: 'subscriber',
    });
  });

  it('folds a second low rating from the same email on the same day', async () => {
    const { useCase, feedbackRepository, sendLowRatingFeedbackEmail } = build();

    await feedbackRepository.insert({
      rating: 1,
      comment: 'first',
      page: '/upload',
      email: 'learner@example.com',
    });
    await useCase.notifyIfLowRating({
      rating: 1,
      comment: 'first',
      page: '/upload',
      email: 'learner@example.com',
      now,
    });

    await feedbackRepository.insert({
      rating: 2,
      comment: 'second',
      page: '/upload',
      email: 'LEARNER@example.com',
    });
    await useCase.notifyIfLowRating({
      rating: 2,
      comment: 'second',
      page: '/upload',
      email: 'LEARNER@example.com',
      now,
    });

    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledTimes(1);
  });

  it('resolves without throwing when the support email fails', async () => {
    const { useCase, feedbackRepository, sendLowRatingFeedbackEmail } = build();
    sendLowRatingFeedbackEmail.mockRejectedValueOnce(
      new Error('sendgrid down')
    );
    await feedbackRepository.insert({
      rating: 1,
      comment: 'broken',
      page: '/upload',
      email: 'learner@example.com',
    });

    await expect(
      useCase.notifyIfLowRating({
        rating: 1,
        comment: 'broken',
        page: '/upload',
        email: 'learner@example.com',
        now,
      })
    ).resolves.toBeUndefined();
    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledTimes(1);
  });
});

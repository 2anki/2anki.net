import type { IEmojiFeedbackRepository } from '../../data_layer/EmojiFeedbackRepository';
import type { ILowRatingContextRepository } from '../../data_layer/LowRatingContextRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import { isLowRating } from '../../lib/feedback/lowRating';

export interface LowRatingNotificationInput {
  rating: number;
  comment: string | null;
  page: string;
  email: string | null;
  now: Date;
}

export interface ILowRatingNotifier {
  notifyIfLowRating(input: LowRatingNotificationInput): Promise<void>;
}

export class NotifyLowRatingUseCase implements ILowRatingNotifier {
  constructor(
    private readonly feedbackRepository: IEmojiFeedbackRepository,
    private readonly contextRepository: ILowRatingContextRepository,
    private readonly emailService: IEmailService
  ) {}

  async notifyIfLowRating(input: LowRatingNotificationInput): Promise<void> {
    const { email } = input;
    if (!isLowRating(input.rating) || email == null) {
      return;
    }

    try {
      const sameDayLowRatings =
        await this.feedbackRepository.countLowRatingsFromEmailOnDay(
          email,
          input.now
        );
      if (sameDayLowRatings > 1) {
        return;
      }

      const context = await this.contextRepository.getByEmail(email);
      await this.emailService.sendLowRatingFeedbackEmail({
        rating: input.rating,
        comment: input.comment,
        page: input.page,
        replyTo: email,
        userId: context.userId,
        latestJobId: context.latestJobId,
        latestJobStatus: context.latestJobStatus,
        plan: context.plan,
      });
    } catch (error) {
      console.error('[low-rating-feedback] notification failed', error);
    }
  }
}

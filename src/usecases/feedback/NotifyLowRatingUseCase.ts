import type { IEmojiFeedbackRepository } from '../../data_layer/EmojiFeedbackRepository';
import type { ILowRatingContextRepository } from '../../data_layer/LowRatingContextRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import type { RateLimiter } from '../../lib/rateLimit/InMemoryRateLimiter';
import { ipRateLimitBucket } from '../../lib/rateLimit/ipHelpers';
import {
  isLowRating,
  isSafeReplyTo,
  resolveFeedbackLink,
} from '../../lib/feedback/lowRating';

export interface LowRatingNotificationInput {
  rating: number;
  comment: string | null;
  page: string;
  email: string | null;
  owner: number | null;
  ip: string;
  now: Date;
}

export interface ILowRatingNotifier {
  notifyIfLowRating(input: LowRatingNotificationInput): Promise<void>;
}

export class NotifyLowRatingUseCase implements ILowRatingNotifier {
  constructor(
    private readonly feedbackRepository: IEmojiFeedbackRepository,
    private readonly contextRepository: ILowRatingContextRepository,
    private readonly emailService: IEmailService,
    private readonly rateLimiter: RateLimiter
  ) {}

  async notifyIfLowRating(input: LowRatingNotificationInput): Promise<void> {
    const { email } = input;
    if (!isLowRating(input.rating) || email == null) {
      return;
    }
    const link = resolveFeedbackLink(input.page);
    if (!isSafeReplyTo(email) || link == null) {
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

      if (!this.rateLimiter.check(ipRateLimitBucket(input.ip))) {
        return;
      }

      const account =
        input.owner == null
          ? null
          : await this.contextRepository.getByOwner(input.owner);
      const matched =
        account != null &&
        account.email.trim().toLowerCase() === email.trim().toLowerCase()
          ? account
          : null;

      await this.emailService.sendLowRatingFeedbackEmail({
        rating: input.rating,
        comment: input.comment,
        page: link,
        replyTo: email,
        emailVerified: matched != null,
        userId: matched?.userId ?? null,
        latestJobId: matched?.latestJobId ?? null,
        latestJobStatus: matched?.latestJobStatus ?? null,
        plan: matched?.plan ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: unknown } | null)?.code;
      console.error('[low-rating-feedback] notification failed', {
        message,
        code,
      });
    }
  }
}

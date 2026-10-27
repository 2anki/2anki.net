import type { IEmojiFeedbackRepository } from '../../data_layer/EmojiFeedbackRepository';
import type {
  ILowRatingContextRepository,
  LowRatingAccountContext,
} from '../../data_layer/LowRatingContextRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import type { RateLimiter } from '../../lib/rateLimit/InMemoryRateLimiter';
import { ipRateLimitBucket } from '../../lib/rateLimit/ipHelpers';
import {
  isLowRating,
  isSafeReplyTo,
  resolveFeedbackLink,
} from '../../lib/feedback/lowRating';
import { isAppleSubscriptionPass } from '../passes/isAppleSubscriptionPass';
import { passKindLabel } from '../passes/passKindLabel';

const describePlan = (account: LowRatingAccountContext): string => {
  if (account.isLifetime) return 'lifetime';
  if (account.hasActiveSubscription) return 'Stripe subscriber';
  const pass = account.activePass;
  if (pass == null) return 'free';
  if (isAppleSubscriptionPass(pass)) return 'Pro (Apple)';
  const boughtIn = pass.stripe_payment_intent_id.startsWith('apple:')
    ? ', Apple'
    : '';
  const activeUntil = `${pass.expires_at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return `${passKindLabel(pass.kind)} (${pass.kind}${boughtIn}), active until ${activeUntil}`;
};

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
          : await this.contextRepository.getByOwner(input.owner, input.now);
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
        latestUploadId: matched?.latestUploadId ?? null,
        latestUploadAt: matched?.latestUploadAt ?? null,
        plan: matched == null ? null : describePlan(matched),
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

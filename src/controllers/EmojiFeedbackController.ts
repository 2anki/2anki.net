import { Request, Response } from 'express';

import { IEmojiFeedbackRepository } from '../data_layer/EmojiFeedbackRepository';
import { ILowRatingNotifier } from '../usecases/feedback/NotifyLowRatingUseCase';
import { getOwnerId } from '../lib/User/getOwner';
import { resolveClientIp } from '../lib/rateLimit/ipHelpers';

const EMAIL_MAX_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, EMAIL_MAX_LENGTH);
  return EMAIL_SHAPE.test(trimmed) ? trimmed : null;
};

class EmojiFeedbackController {
  constructor(
    private readonly repo: IEmojiFeedbackRepository,
    private readonly notifier: ILowRatingNotifier
  ) {}

  async submit(req: Request, res: Response) {
    const { rating, comment, page, email } = req.body;

    if (
      typeof rating !== 'number' ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      res.status(400).json({ message: 'Rating must be 1-5.' });
      return;
    }

    if (typeof page !== 'string' || page.trim().length === 0) {
      res.status(400).json({ message: 'Page is required.' });
      return;
    }

    const sanitizedComment =
      typeof comment === 'string' && comment.trim().length > 0
        ? comment.trim().slice(0, 2000)
        : null;
    const sanitizedPage = page.trim().slice(0, 255);
    const sanitizedEmail = parseEmail(email);

    try {
      await this.repo.insert({
        rating,
        comment: sanitizedComment,
        page: sanitizedPage,
        email: sanitizedEmail,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to save feedback.' });
      return;
    }

    res.status(201).json({ message: 'Thank you for your feedback!' });

    await this.notifier.notifyIfLowRating({
      rating,
      comment: sanitizedComment,
      page: sanitizedPage,
      email: sanitizedEmail,
      owner: getOwnerId(res),
      ip: resolveClientIp(req),
      now: new Date(),
    });
  }
}

export default EmojiFeedbackController;

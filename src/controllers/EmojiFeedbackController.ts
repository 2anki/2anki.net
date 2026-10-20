import { Request, Response } from 'express';

import { IEmojiFeedbackRepository } from '../data_layer/EmojiFeedbackRepository';
import { ILowRatingNotifier } from '../usecases/feedback/NotifyLowRatingUseCase';
import { IRatedConversionResolver } from '../usecases/feedback/ResolveRatedConversionUseCase';
import { getOwnerId } from '../lib/User/getOwner';
import { resolveClientIp } from '../lib/rateLimit/ipHelpers';

const EMAIL_MAX_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INPUT_FORMAT_MAX_LENGTH = 64;

const parseEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, EMAIL_MAX_LENGTH);
  return EMAIL_SHAPE.test(trimmed) ? trimmed : null;
};

const parseId = (value: unknown): number | null => {
  const id =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
};

const parseInputFormat = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, INPUT_FORMAT_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
};

class EmojiFeedbackController {
  constructor(
    private readonly repo: IEmojiFeedbackRepository,
    private readonly notifier: ILowRatingNotifier,
    private readonly conversionResolver: IRatedConversionResolver
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
    const owner = getOwnerId(res);
    const inputFormat = parseInputFormat(req.body.input_format);
    const conversion = await this.conversionResolver.resolve({
      owner,
      jobId: parseId(req.body.job_id),
      uploadId: parseId(req.body.upload_id),
    });

    try {
      await this.repo.insert({
        rating,
        comment: sanitizedComment,
        page: sanitizedPage,
        email: sanitizedEmail,
        owner,
        jobId: conversion.jobId,
        uploadId: conversion.uploadId,
        inputFormat,
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
      owner,
      ip: resolveClientIp(req),
      now: new Date(),
    });
  }
}

export default EmojiFeedbackController;

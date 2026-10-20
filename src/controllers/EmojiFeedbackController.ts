import { Request, Response } from 'express';

import { IEmojiFeedbackRepository } from '../data_layer/EmojiFeedbackRepository';
import { ILowRatingNotifier } from '../usecases/feedback/NotifyLowRatingUseCase';
import {
  IRatedConversionResolver,
  ResolvedRatedConversion,
} from '../usecases/feedback/ResolveRatedConversionUseCase';
import { getOwnerId } from '../lib/User/getOwner';
import { resolveClientIp } from '../lib/rateLimit/ipHelpers';

const EMAIL_MAX_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SIGNED_INT = 2147483647;

// The client sends the rated deck row's source. It must be one of the known
// DeckRow sources; anything else is dropped so a stray string never lands in
// the column.
const INPUT_FORMATS = new Set([
  'notion',
  'upload',
  'mcp',
  'app',
  'dropbox',
  'drive',
]);

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
  return Number.isInteger(id) && id > 0 && id <= MAX_SIGNED_INT ? id : null;
};

const parseInputFormat = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return INPUT_FORMATS.has(trimmed) ? trimmed : null;
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
    const conversion = await this.resolveConversion(
      owner,
      parseId(req.body.job_id),
      parseId(req.body.upload_id)
    );

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

  private async resolveConversion(
    owner: number | null,
    jobId: number | null,
    uploadId: number | null
  ): Promise<ResolvedRatedConversion> {
    try {
      return await this.conversionResolver.resolve({ owner, jobId, uploadId });
    } catch (error) {
      console.error('[emoji-feedback] conversion resolve failed', error);
      return { jobId: null, uploadId: null };
    }
  }
}

export default EmojiFeedbackController;

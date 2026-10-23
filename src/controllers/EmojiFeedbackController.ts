import { timingSafeEqual } from 'node:crypto';
import { Request, Response } from 'express';

import { IEmojiFeedbackRepository } from '../data_layer/EmojiFeedbackRepository';
import { ILowRatingNotifier } from '../usecases/feedback/NotifyLowRatingUseCase';
import {
  IRatedConversionResolver,
  ResolvedRatedConversion,
} from '../usecases/feedback/ResolveRatedConversionUseCase';
import { getOwnerId } from '../lib/User/getOwner';
import hmacToken from '../lib/misc/hmacToken';
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

const followUpToken = (id: number): string =>
  hmacToken(`emoji-feedback-follow-up:${id}`);

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

    let id: number | null;
    try {
      id = await this.repo.insert({
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

    res.status(201).json({
      message: 'Thank you for your feedback!',
      id,
      token: id == null ? null : this.safeFollowUpToken(id),
    });

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

  private safeFollowUpToken(id: number): string | null {
    try {
      return followUpToken(id);
    } catch (error) {
      console.error('[emoji-feedback] follow-up token unavailable', error);
      return null;
    }
  }

  // The rating is saved on the first tap; the comment and reply email follow
  // later against the same row, proved by the token the first call returned.
  async followUp(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const token = req.body?.token;
    if (id == null || typeof token !== 'string') {
      res.status(400).json({ message: 'Invalid follow-up.' });
      return;
    }
    const expected = followUpToken(id);
    const given = Buffer.from(token);
    const wanted = Buffer.from(expected);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      res.status(403).json({ message: 'Invalid follow-up.' });
      return;
    }

    const { comment, email } = req.body;
    const sanitizedComment =
      typeof comment === 'string' && comment.trim().length > 0
        ? comment.trim().slice(0, 2000)
        : null;
    const sanitizedEmail = parseEmail(email);

    let target;
    try {
      target = await this.repo.attachFollowUp(id, {
        comment: sanitizedComment,
        email: sanitizedEmail,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to save feedback.' });
      return;
    }

    res.status(200).json({ message: 'Thank you for your feedback!' });
    if (target == null) return;

    await this.notifier.notifyIfLowRating({
      rating: target.rating,
      comment: sanitizedComment,
      page: target.page,
      email: sanitizedEmail,
      owner: target.owner,
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

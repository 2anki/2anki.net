import { Request, Response } from 'express';

import { isKnownDeckDistributionAnswer } from '../lib/deckDistribution/answers';
import { SubmitDeckDistributionIntentUseCase } from '../usecases/SubmitDeckDistributionIntentUseCase';
import type { IDeckDistributionIntentRepository } from '../data_layer/DeckDistributionIntentRepository';

const EMAIL_MAX_LENGTH = 254;
const UPLOAD_KEY_MAX_LENGTH = 512;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, EMAIL_MAX_LENGTH);
  return EMAIL_SHAPE.test(trimmed) ? trimmed : null;
};

const parseUploadKey = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, UPLOAD_KEY_MAX_LENGTH);
};

export class DeckDistributionIntentController {
  private readonly submitUseCase: SubmitDeckDistributionIntentUseCase;

  constructor(repo: IDeckDistributionIntentRepository) {
    this.submitUseCase = new SubmitDeckDistributionIntentUseCase(repo);
  }

  async submit(req: Request, res: Response): Promise<void> {
    const {
      answer,
      upload_key: uploadKeyRaw,
      notify_email: notifyEmail,
    } = req.body;

    if (!isKnownDeckDistributionAnswer(answer)) {
      res.status(400).json({ message: 'Unknown answer.' });
      return;
    }

    const uploadKey = parseUploadKey(uploadKeyRaw);
    if (uploadKey == null) {
      res.status(400).json({ message: 'upload_key is required.' });
      return;
    }

    const userId = res.locals.owner as number | undefined;
    if (userId == null) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    await this.submitUseCase.execute({
      userId,
      answer,
      uploadKey,
      notifyEmail: parseEmail(notifyEmail),
    });

    res.status(201).json({ message: 'Thanks for telling us.' });
  }
}

export default DeckDistributionIntentController;

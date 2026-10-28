import { Request, Response } from 'express';

import type { IReEngagementRepository } from '../data_layer/ReEngagementRepository';
import type { IEmailPreferencesRepository } from '../data_layer/EmailPreferencesRepository';
import { SubmitReEngagementFeedbackUseCase } from '../usecases/SubmitReEngagementFeedbackUseCase';
import { UpdateEmailPreferencesUseCase } from '../usecases/UpdateEmailPreferencesUseCase';

export class ReEngagementController {
  private readonly submitUseCase: SubmitReEngagementFeedbackUseCase;
  private readonly updatePrefsUseCase: UpdateEmailPreferencesUseCase;

  constructor(
    private readonly repo: IReEngagementRepository,
    private readonly prefRepo: IEmailPreferencesRepository
  ) {
    this.submitUseCase = new SubmitReEngagementFeedbackUseCase(repo);
    this.updatePrefsUseCase = new UpdateEmailPreferencesUseCase(prefRepo);
  }

  async validateToken(req: Request, res: Response): Promise<void> {
    const uid = req.query['uid'];
    if (typeof uid !== 'string' || uid.trim().length === 0) {
      res.status(400).json({ message: 'uid is required.' });
      return;
    }

    const record = await this.repo.findByToken(uid.trim());
    if (record == null) {
      res.status(404).json({ message: 'Survey link not found.' });
      return;
    }

    res.status(200).json({ valid: true, emailId: record.id });
  }

  async submitFeedback(req: Request, res: Response): Promise<void> {
    const { token, stoppedReason, contentType, comment } = req.body;

    if (typeof token !== 'string' || token.trim().length === 0) {
      res.status(400).json({ message: 'token is required.' });
      return;
    }
    if (
      typeof stoppedReason !== 'string' ||
      stoppedReason.trim().length === 0
    ) {
      res.status(400).json({ message: 'stoppedReason is required.' });
      return;
    }
    if (typeof contentType !== 'string' || contentType.trim().length === 0) {
      res.status(400).json({ message: 'contentType is required.' });
      return;
    }

    try {
      await this.submitUseCase.execute({
        token: token.trim(),
        stoppedReason: stoppedReason.trim().slice(0, 64),
        contentType: contentType.trim().slice(0, 64),
        comment:
          typeof comment === 'string' && comment.trim().length > 0
            ? comment.trim()
            : null,
      });
    } catch {
      res.status(404).json({ message: 'Survey link not found.' });
      return;
    }

    res.status(200).json({ message: 'Thank you for your feedback!' });
  }

  async unsubscribe(req: Request, res: Response): Promise<void> {
    const uid = req.query['uid'];
    if (typeof uid !== 'string' || uid.trim().length === 0) {
      res.status(400).json({ message: 'uid is required.' });
      return;
    }

    const record = await this.repo.findByToken(uid.trim());
    if (record == null) {
      res.status(404).json({ message: 'Unsubscribe link not found.' });
      return;
    }

    await this.updatePrefsUseCase.execute({
      userId: record.userId,
      marketingOptOut: true,
    });

    res.status(200).json({ message: 'You have been unsubscribed.' });
  }
}

import express from 'express';
import { DismissPitchUseCase } from '../usecases/pitches/DismissPitchUseCase';
import { ShouldShowAutoSyncPitchUseCase } from '../usecases/pitches/ShouldShowAutoSyncPitchUseCase';
import SubscriptionService from '../services/SubscriptionService';
import {
  PITCH_PLACEMENTS,
  type PitchPlacement,
} from '../data_layer/PitchDismissalsRepository';

export class PitchController {
  constructor(
    private readonly dismissPitchUseCase: DismissPitchUseCase,
    private readonly shouldShowUseCase: ShouldShowAutoSyncPitchUseCase
  ) {}

  async dismiss(req: express.Request, res: express.Response): Promise<void> {
    const userId: string = res.locals.owner;
    const { placement } = req.body as { placement?: unknown };

    if (
      typeof placement !== 'string' ||
      !PITCH_PLACEMENTS.includes(placement as PitchPlacement)
    ) {
      res.status(400).json({ message: 'Invalid placement' });
      return;
    }

    await this.dismissPitchUseCase.execute(userId, placement as PitchPlacement);
    res.status(204).end();
  }

  async autoSyncEligibility(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    const userId: string = res.locals.owner;
    const email: string | undefined = res.locals.email;
    const { objectId, jobType } = req.query as {
      objectId?: string;
      jobType?: string;
    };

    const subscriptions = email
      ? await SubscriptionService.getUserActiveSubscriptions(email)
      : [];

    const result = await this.shouldShowUseCase.execute({
      user: {
        patreon: (res.locals.patreon as boolean | null | undefined) ?? null,
      },
      subscriptions,
      userId,
      objectId: objectId ?? '',
      jobType: jobType ?? null,
    });

    res.json(result);
  }
}

import { Request, Response } from 'express';

import {
  ClaimRecoveryDeckUseCase,
  NoRecoveryDeckError,
  RecoveryDeckNotSavedError,
} from '../../usecases/uploads/ClaimRecoveryDeckUseCase';
import { isRecoveryToken } from '../../lib/upload/anonymousRecovery';
import { getSafeFilename } from '../../lib/getSafeFilename';
import { getOwner } from '../../lib/User/getOwner';
import { track } from '../../services/events/track';
import { anonIdCookie } from './anonIdCookie';

const MAX_DECK_NAME_LENGTH = 200;

function deckNameFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return getSafeFilename(trimmed.slice(0, MAX_DECK_NAME_LENGTH));
}

export class ClaimRecoveryDeckController {
  constructor(private readonly useCase: ClaimRecoveryDeckUseCase) {}

  async claim(req: Request, res: Response): Promise<Response> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const recoveryToken = body.recoveryToken;
    const deckName = deckNameFrom(body.deckName);
    if (!isRecoveryToken(recoveryToken) || deckName == null) {
      return res.status(400).json({ code: 'invalid_recovery_claim' });
    }
    const owner = String(getOwner(res));
    const anonId = anonIdCookie(req);
    try {
      const claimed = await this.useCase.execute({
        anonId,
        recoveryToken,
        deckName,
        owner,
        requestId: res.locals.requestId as string | undefined,
      });
      track('recovery_deck_claimed', {
        userId: Number(owner),
        anonymousId: anonId,
      });
      return res.status(200).json({
        downloadKey: claimed.downloadKey,
        deckName: claimed.deckName,
      });
    } catch (err) {
      if (err instanceof NoRecoveryDeckError) {
        return res.status(404).json({ code: 'no_recovery_deck' });
      }
      if (err instanceof RecoveryDeckNotSavedError) {
        return res.status(503).json({ code: 'recovery_deck_not_saved' });
      }
      throw err;
    }
  }
}

export default ClaimRecoveryDeckController;

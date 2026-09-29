import { Request, Response } from 'express';

import {
  ClaimHeldDeckUseCase,
  HeldDeckExpiredError,
  NoHeldDeckError,
} from '../../usecases/uploads/ClaimHeldDeckUseCase';
import { getOwner } from '../../lib/User/getOwner';
import { isPaying } from '../../lib/isPaying';
import { track } from '../../services/events/track';

function anonId(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.anon_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export class ClaimHeldDeckController {
  constructor(private readonly useCase: ClaimHeldDeckUseCase) {}

  async check(req: Request, res: Response): Promise<Response> {
    const hold = await this.useCase.peek(anonId(req));
    if (hold == null) {
      return res.status(204).send();
    }
    return res.status(200).json({
      cardCount: hold.cardCount,
      cardsHeldBack: hold.cardsHeldBack,
    });
  }

  async claim(req: Request, res: Response): Promise<Response> {
    const owner = String(getOwner(res));
    try {
      const result = await this.useCase.execute({
        anonId: anonId(req),
        owner,
        paying: isPaying(res.locals),
        requestId: res.locals.requestId,
      });
      track('anonymous_partial_claimed', {
        userId: Number(owner),
        anonymousId: anonId(req),
        props: { arm: 'treatment' },
      });
      return res.status(200).json({
        downloadKey: result.downloadKey,
        cardCount: result.cardCount,
        deckName: result.deckName,
      });
    } catch (err) {
      if (err instanceof NoHeldDeckError) {
        return res.status(404).json({ code: 'no_held_deck' });
      }
      if (err instanceof HeldDeckExpiredError) {
        return res.status(410).json({ code: 'held_deck_expired' });
      }
      throw err;
    }
  }
}

export default ClaimHeldDeckController;

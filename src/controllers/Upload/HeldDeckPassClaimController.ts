import { Request, Response } from 'express';

import {
  HeldDeckExpiredError,
  NoHeldDeckError,
} from '../../usecases/uploads/ClaimHeldDeckUseCase';
import { ClaimHeldDeckWithPassUseCase } from '../../usecases/uploads/ClaimHeldDeckWithPassUseCase';
import { EmptyDeckError } from '../../usecases/jobs/EmptyDeckError';
import { getAnonymousPassId } from '../../lib/User/getOwner';
import { track } from '../../services/events/track';

function anonId(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.anon_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function cardOptionsFrom(body: unknown): Record<string, string> {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

export class HeldDeckPassClaimController {
  constructor(private readonly useCase: ClaimHeldDeckWithPassUseCase) {}

  async claim(req: Request, res: Response): Promise<Response> {
    const anonymousPassId = getAnonymousPassId(res);
    if (anonymousPassId == null) {
      return res.status(403).json({ code: 'pass_required' });
    }
    const visitor = anonId(req);
    if (visitor == null) {
      return res.status(404).json({ code: 'no_held_deck' });
    }
    try {
      const { apkg, cardCount, deckName } = await this.useCase.execute({
        anonymousPassId,
        anonId: visitor,
        cardOptions: cardOptionsFrom(req.body),
        requestId: res.locals.requestId as string | undefined,
      });
      track('anonymous_pass_held_claimed', {
        anonymousId: visitor,
        anonymousPassId,
        props: { card_count: cardCount, pass_kind: res.locals.passKind },
      });
      res.attachment(`/${deckName}`);
      res.set('Content-Type', 'application/apkg');
      res.set('Content-Length', Buffer.byteLength(apkg).toString());
      res.set('X-Card-Count', cardCount.toString());
      try {
        res.set('File-Name', encodeURIComponent(deckName));
      } catch {
        // A deck name that can't be URI-encoded still ships the apkg; the
        // client falls back to its default download filename.
      }
      res.set('Access-Control-Expose-Headers', 'File-Name, X-Card-Count');
      return res.status(200).send(apkg);
    } catch (err) {
      if (err instanceof NoHeldDeckError) {
        return res.status(404).json({ code: 'no_held_deck' });
      }
      if (err instanceof HeldDeckExpiredError) {
        return res.status(410).json({ code: 'held_deck_expired' });
      }
      if (err instanceof EmptyDeckError) {
        return res.status(400).json({ code: 'empty_export' });
      }
      throw err;
    }
  }
}

export default HeldDeckPassClaimController;

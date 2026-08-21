import { Request, Response } from 'express';
import { TagCardsUseCase } from '../usecases/chat/TagCardsUseCase';

const MAX_CARDS = 200;

interface TagCardInput {
  front: string;
  back: string;
}

function parseInputCard(item: unknown): TagCardInput | null {
  if (item == null || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  if (typeof record.front !== 'string') return null;
  const back = typeof record.back === 'string' ? record.back : '';
  return { front: record.front, back };
}

function parseConversationId(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0)
    return raw;
  if (typeof raw === 'string' && /^[1-9]\d*$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

class TagCardsController {
  constructor(private readonly useCase: TagCardsUseCase) {}

  async tag(req: Request, res: Response) {
    const rawCards = req.body?.cards;

    if (!Array.isArray(rawCards) || rawCards.length === 0) {
      res.status(400).json({ error: 'cards must be a non-empty array' });
      return;
    }

    if (rawCards.length > MAX_CARDS) {
      res
        .status(400)
        .json({ error: `cards must have at most ${MAX_CARDS} items` });
      return;
    }

    const parsedCards = rawCards.map(parseInputCard);
    if (parsedCards.some((c) => c == null)) {
      res
        .status(400)
        .json({ error: 'each card must have a string front field' });
      return;
    }

    const owner = res.locals.owner as number;
    const conversationId = parseConversationId(req.body?.conversationId);

    const result = await this.useCase.execute({
      cards: parsedCards as TagCardInput[],
      userId: owner,
      conversationId,
    });
    res.status(200).json(result);
  }
}

export default TagCardsController;

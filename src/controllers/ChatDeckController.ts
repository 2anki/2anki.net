import { Request, Response } from 'express';
import {
  ChatDeckUseCase,
  type ChatDeckCard,
} from '../usecases/chat/ChatDeckUseCase';
import { MonthlyLimitError } from '../usecases/users/CheckMonthlyCardLimitUseCase';
import { buildContentDisposition } from '../lib/buildContentDisposition';
import { getOwner } from '../lib/User/getOwner';
import { isPaying } from '../lib/isPaying';

const MAX_DECK_NAME_LENGTH = 120;
const MAX_CARDS = 200;
const REQUIRED_MCQ_OPTION_COUNT = 4;
const MAX_TAGS_PER_CARD = 8;
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,23}$/;

function parseTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_TAGS_PER_CARD) break;
    if (typeof item !== 'string') continue;
    const cleaned = item
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    if (!TAG_PATTERN.test(cleaned) || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out.length > 0 ? out : undefined;
}

function asMcqShape(record: Record<string, unknown>): ChatDeckCard | null {
  if (typeof record.front !== 'string') return null;
  const options = record.options;
  if (!Array.isArray(options) || options.length !== REQUIRED_MCQ_OPTION_COUNT)
    return null;
  if (
    !options.every(
      (opt): opt is string => typeof opt === 'string' && opt.trim().length > 0
    )
  ) {
    return null;
  }
  const correctIndex = record.correctIndex;
  if (typeof correctIndex !== 'number' || !Number.isInteger(correctIndex))
    return null;
  if (correctIndex < 0 || correctIndex >= options.length) return null;
  const rationale =
    typeof record.rationale === 'string' ? record.rationale : '';
  const tags = parseTags(record.tags);
  return {
    front: record.front,
    back: '',
    options,
    correctIndex,
    ...(rationale.length > 0 ? { rationale } : {}),
    ...(tags != null ? { tags } : {}),
  };
}

function parseCard(item: unknown): ChatDeckCard | null {
  if (item == null || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  if (record.options !== undefined || record.correctIndex !== undefined) {
    return asMcqShape(record);
  }
  if (typeof record.front === 'string' && typeof record.back === 'string') {
    const tags = parseTags(record.tags);
    return {
      front: record.front,
      back: record.back,
      ...(tags != null ? { tags } : {}),
    };
  }
  return null;
}

class ChatDeckController {
  constructor(private readonly useCase: ChatDeckUseCase) {}

  async generate(req: Request, res: Response) {
    const rawDeckName = req.body?.deckName;
    const deckName = typeof rawDeckName === 'string' ? rawDeckName.trim() : '';

    if (deckName.length === 0) {
      res.status(400).json({ error: 'deckName is required' });
      return;
    }

    if (deckName.length > MAX_DECK_NAME_LENGTH) {
      res.status(400).json({
        error: `deckName must be ${MAX_DECK_NAME_LENGTH} characters or fewer`,
      });
      return;
    }

    const rawCards = req.body?.cards;

    if (!Array.isArray(rawCards)) {
      res.status(400).json({ error: 'cards must be a non-empty array' });
      return;
    }

    if (rawCards.length === 0) {
      res.status(400).json({ error: 'cards must be a non-empty array' });
      return;
    }

    if (rawCards.length > MAX_CARDS) {
      res
        .status(400)
        .json({ error: `cards must have at most ${MAX_CARDS} items` });
      return;
    }

    const parsedCards = rawCards.map(parseCard);
    if (parsedCards.some((c) => c == null)) {
      res.status(400).json({
        error:
          'each card must have string front and back fields, or a valid MCQ shape',
      });
      return;
    }

    const rawTemplateSlug = req.body?.templateSlug;
    const templateSlug =
      typeof rawTemplateSlug === 'string' ? rawTemplateSlug : null;

    let buffer: Buffer;
    try {
      buffer = await this.useCase.execute({
        cards: parsedCards as ChatDeckCard[],
        deckName,
        templateSlug,
        userId: getOwner(res),
        isPaying: isPaying(res.locals),
      });
    } catch (error) {
      if (error instanceof MonthlyLimitError) {
        res.status(402).json({
          code: 'monthly_limit',
          cards_used: error.cards_used,
          limit: error.limit,
          reset_on: error.reset_on,
        });
        return;
      }
      throw error;
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      buildContentDisposition(`${deckName}.apkg`)
    );
    res.send(buffer);
  }
}

export default ChatDeckController;

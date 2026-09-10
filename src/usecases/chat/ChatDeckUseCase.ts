import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import CustomExporter from '../../lib/parser/exporters/CustomExporter';
import UsersRepository from '../../data_layer/UsersRepository';
import { CheckMonthlyCardLimitUseCase } from '../users/CheckMonthlyCardLimitUseCase';
import { templateForbidsCloze } from './chatTemplates';

export interface ChatDeckCard {
  front: string;
  back: string;
  options?: string[];
  correctIndex?: number;
  rationale?: string;
  template?: string;
  tags?: string[];
}

export interface ChatDeckInput {
  cards: ChatDeckCard[];
  deckName: string;
  templateSlug?: string | null;
  userId: string | number;
  isPaying: boolean;
}

function isMcqCard(card: ChatDeckCard): boolean {
  return Array.isArray(card.options) && typeof card.correctIndex === 'number';
}

function randomDeckId(): number {
  const hex = createHash('sha1')
    .update(randomUUID())
    .digest('hex')
    .slice(0, 13);
  return Number.parseInt(hex, 16) % 1e13;
}

const CLOZE_PATTERN = /\{\{c\d+::/;
const CLOZE_REPLACE_PATTERN = /\{\{c\d+::([\s\S]*?)\}\}/g;
const BLANK_PATTERN = /_{2,}/;

export function looksLikeCloze(front: string): boolean {
  return CLOZE_PATTERN.test(front);
}

const MCQ_STEM_BLANK = '_____';

export function stripClozeFromStem(front: string): string {
  return front.replace(CLOZE_REPLACE_PATTERN, MCQ_STEM_BLANK);
}

export function normalizeBasicCard(card: ChatDeckCard): ChatDeckCard {
  if (!looksLikeCloze(card.front)) return card;
  const answers: string[] = [];
  const front = card.front.replace(
    CLOZE_REPLACE_PATTERN,
    (_match, answer: string) => {
      answers.push(answer.trim());
      return '[...]';
    }
  );
  return { ...card, front, back: answers.join(', ') };
}

export function transformBlankToCloze(card: ChatDeckCard): ChatDeckCard {
  if (CLOZE_PATTERN.test(card.front)) return card;
  if (!BLANK_PATTERN.test(card.front)) return card;
  const trimmedBack = card.back.trim();
  if (trimmedBack.length === 0) return card;
  return {
    front: card.front.replace(BLANK_PATTERN, `{{c1::${trimmedBack}}}`),
    back: '',
  };
}

function expandForTemplate(
  cards: ChatDeckCard[],
  templateSlug: string | null | undefined
): ChatDeckCard[] {
  if (templateSlug !== 'basic-and-reversed') return cards;
  const expanded: ChatDeckCard[] = [];
  for (const card of cards) {
    expanded.push(card);
    if (
      !isMcqCard(card) &&
      !looksLikeCloze(card.front) &&
      card.back.trim().length > 0
    ) {
      expanded.push({ front: card.back, back: card.front, tags: card.tags });
    }
  }
  return expanded;
}

export class ChatDeckUseCase {
  constructor(private readonly usersRepository: UsersRepository) {}

  async execute(input: ChatDeckInput): Promise<Buffer> {
    const { cards, deckName, templateSlug, userId, isPaying } = input;
    const cardCount = cards.length;
    await new CheckMonthlyCardLimitUseCase(this.usersRepository).execute({
      userId,
      candidateCardCount: cardCount,
      isPaying,
    });
    const workspaceDir = path.join(os.tmpdir(), `chat-deck-${randomUUID()}`);
    fs.mkdirSync(workspaceDir, { recursive: true });

    try {
      const forbidCloze = templateForbidsCloze(templateSlug);
      const preparedCards = cards.map((c) => {
        if (isMcqCard(c)) return c;
        const withCloze = transformBlankToCloze(c);
        return forbidCloze ? normalizeBasicCard(withCloze) : withCloze;
      });
      const normalizedCards = expandForTemplate(preparedCards, templateSlug);
      const deckInfo = [
        {
          name: deckName,
          image: '',
          style: null,
          id: randomDeckId(),
          settings: {
            template: 'specialstyle',
            clozeModelName: 'n2a-cloze',
            basicModelName: 'n2a-basic',
            inputModelName: 'n2a-input',
            useNotionId: false,
          },
          cards: normalizedCards.map((c, index) => {
            const base = {
              name: c.front,
              tags: c.tags ?? [],
              number: index,
              enableInput: false,
              answer: '',
              media: [],
            };
            if (isMcqCard(c)) {
              return {
                ...base,
                back: c.rationale ?? '',
                cloze: false,
                mcq: true,
                options: c.options,
                correctIndices: [c.correctIndex],
              };
            }
            return {
              ...base,
              back: c.back,
              cloze: looksLikeCloze(c.front),
            };
          }),
        },
      ];

      const exporter = new CustomExporter(deckName, workspaceDir);
      exporter.configure(deckInfo as never);
      const buffer = await exporter.save();
      await this.usersRepository.incrementCardUsage(userId, cardCount);
      return buffer;
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  }
}

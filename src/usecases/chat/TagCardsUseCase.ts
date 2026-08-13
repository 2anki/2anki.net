import type Anthropic from '@anthropic-ai/sdk';
import { recordClaudeUsage } from '../../lib/claude/recordClaudeUsage';
import type { IChatMessagesRepository } from '../../data_layer/ChatMessagesRepository';
import {
  rewriteAssistantContentWithTaggedCards,
  extractCards,
  assertWithinMonthlyQuota,
} from './ChatUseCase';

const TAGGING_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;
const MAX_TAGS_PER_CARD = 3;

const TAGGING_SYSTEM_PROMPT = `You suggest short subject tags for Anki flashcards.

For each card you receive, output 1 to ${MAX_TAGS_PER_CARD} concise tags describing the card's subject area or topic. Tags must be lowercase, hyphenated (no spaces), and shorter than 24 characters each. Avoid generic tags like "card", "flashcard", "study", "anki", "fact".

Return ONLY a JSON array of arrays — one inner array of strings per input card, in the same order. No prose, no markdown, no code fences.

Example input: 2 cards.
Example output:
[["geography","norway"],["math","fractions"]]`;

export interface TagCardsInput {
  cards: { front: string; back: string }[];
  userId?: number;
  patreon?: boolean;
  conversationId?: number | null;
}

export interface TagCardsResult {
  tags: string[][];
}

const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,23}$/;

function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  if (!TAG_PATTERN.test(cleaned)) return null;
  return cleaned;
}

function normalizeTagList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_TAGS_PER_CARD) break;
    const tag = normalizeTag(item);
    if (tag != null && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

export function parseTagsResponse(
  text: string,
  expectedLength: number
): string[][] {
  const trimmed = text.trim();
  const stripped = trimmed.startsWith('```')
    ? trimmed
        .replace(/^```[a-zA-Z]*\s*/, '')
        .replace(/```$/, '')
        .trim()
    : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return Array.from({ length: expectedLength }, () => []);
  }
  if (!Array.isArray(parsed)) {
    return Array.from({ length: expectedLength }, () => []);
  }
  const out: string[][] = [];
  for (let i = 0; i < expectedLength; i++) {
    out.push(normalizeTagList(parsed[i]));
  }
  return out;
}

export class TagCardsUseCase {
  constructor(
    private readonly anthropic: Anthropic,
    private readonly messagesRepo?: IChatMessagesRepository
  ) {}

  async execute(input: TagCardsInput): Promise<TagCardsResult> {
    if (this.messagesRepo != null && input.userId != null) {
      await assertWithinMonthlyQuota(this.messagesRepo, {
        owner: input.userId,
        patreon: input.patreon ?? false,
      });
    }

    if (input.cards.length === 0) {
      return { tags: [] };
    }

    const userPayload = input.cards.map((c, i) => ({
      i,
      front: c.front,
      back: c.back,
    }));

    const message = await this.anthropic.messages.create({
      model: TAGGING_MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: TAGGING_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Tag these ${userPayload.length} cards:\n\n${JSON.stringify(userPayload)}`,
        },
      ],
    });

    recordClaudeUsage({
      surface: 'chat_tagging',
      model: message.model,
      usage: message.usage,
      userId: input.userId ?? null,
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const tags = parseTagsResponse(text, input.cards.length);

    if (
      this.messagesRepo != null &&
      input.userId != null &&
      input.conversationId != null
    ) {
      await this.persistTags({
        userId: input.userId,
        conversationId: input.conversationId,
        cards: input.cards,
        tags,
      });
    }

    return { tags };
  }

  private async persistTags(input: {
    userId: number;
    conversationId: number;
    cards: { front: string; back: string }[];
    tags: string[][];
  }): Promise<void> {
    if (this.messagesRepo == null) return;
    const latest = await this.messagesRepo.findLatestAssistantInConversation({
      userId: input.userId,
      conversationId: input.conversationId,
    });
    if (latest == null) return;
    const { cards: storedCards } = extractCards(latest.content, true);
    if (storedCards == null) return;
    const tagged = storedCards.map((c, i) => ({
      ...c,
      tags: input.tags[i] ?? [],
    }));
    const newContent = rewriteAssistantContentWithTaggedCards(
      latest.content,
      tagged
    );
    await this.messagesRepo.updateContent({
      userId: input.userId,
      messageId: latest.id,
      content: newContent,
    });
  }
}

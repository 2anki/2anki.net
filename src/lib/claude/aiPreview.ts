import type Anthropic from '@anthropic-ai/sdk';
import { CONVERSION_MODEL, getAnthropicClient } from './ClaudeService';
import { recordClaudeUsage, type ClaudeUsage } from './recordClaudeUsage';

// A no-account preview is free AI, so its cost is bounded by construction, not
// by a credit balance: the input is hard-truncated to this many characters
// (~3.4k tokens with the fixed system prompt) regardless of the uploaded file's
// size, and the output is capped at AI_PREVIEW_MAX_TOKENS. One preview therefore
// has a fixed worst-case cost whatever a visitor uploads.
export const AI_PREVIEW_MAX_INPUT_CHARS = 12_000;
export const AI_PREVIEW_MAX_TOKENS = 1_536;
export const AI_PREVIEW_CARD_COUNT = 5;
export const AI_PREVIEW_SURFACE = 'ai_preview';
// A preview is a short sample, so a hung call is cut off well before a person
// would wait that long and before it can hold an upload slot for minutes. No
// retries: a retry would double the worst-case hold and the cost of one sample.
export const AI_PREVIEW_TIMEOUT_MS = 30_000;

const PREVIEW_SYSTEM_PROMPT = `You write a short sample of Anki flashcards from study material a learner uploaded.
Read the text and write at most ${AI_PREVIEW_CARD_COUNT} clear question-and-answer cards drawn from the most important points near the start.
Work only from the text given; do not invent facts it does not contain.
Return ONLY a JSON array of objects, each {"front": "<question>", "back": "<answer>"}, and nothing else. If the text has no study content, return [].`;

export interface AiPreviewCard {
  front: string;
  back: string;
}

export interface AiPreviewClient {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { timeout?: number; maxRetries?: number }
    ): Promise<{
      model?: string;
      usage?: ClaudeUsage | null;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };
}

export interface GenerateAiPreviewDeps {
  client?: AiPreviewClient;
  recordUsage?: typeof recordClaudeUsage;
  requestId?: string;
}

function textOf(content: Array<{ type?: string; text?: string }>): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function parsePreviewCards(text: string): AiPreviewCard[] {
  const jsonArray = extractJsonArray(text);
  if (jsonArray == null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonArray);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const cards: AiPreviewCard[] = [];
  for (const entry of parsed) {
    if (entry == null || typeof entry !== 'object') {
      continue;
    }
    const front = (entry as { front?: unknown }).front;
    const back = (entry as { back?: unknown }).back;
    if (
      typeof front === 'string' &&
      front.trim().length > 0 &&
      typeof back === 'string' &&
      back.trim().length > 0
    ) {
      cards.push({ front, back });
    }
  }
  return cards;
}

// Runs one bounded Claude call to sample the cards the full AI conversion would
// write, for a visitor without an account. The call bills no user and no pass —
// it is recorded under the ai_preview surface so its cost can be read on its own
// and never counts against a pass's credits.
export async function generateAiPreview(
  text: string,
  deps: GenerateAiPreviewDeps = {}
): Promise<AiPreviewCard[]> {
  const input = text.slice(0, AI_PREVIEW_MAX_INPUT_CHARS);
  if (input.trim().length === 0) {
    return [];
  }
  const client =
    deps.client ?? (getAnthropicClient() as unknown as AiPreviewClient);
  const start = Date.now();
  const response = await client.messages.create(
    {
      model: CONVERSION_MODEL,
      max_tokens: AI_PREVIEW_MAX_TOKENS,
      system: [{ type: 'text', text: PREVIEW_SYSTEM_PROMPT }],
      messages: [{ role: 'user', content: input }],
    } as Anthropic.MessageCreateParamsNonStreaming,
    { timeout: AI_PREVIEW_TIMEOUT_MS, maxRetries: 0 }
  );
  (deps.recordUsage ?? recordClaudeUsage)({
    surface: AI_PREVIEW_SURFACE,
    model: response.model,
    usage: response.usage,
    requestId: deps.requestId,
    durationMs: Date.now() - start,
  });
  return parsePreviewCards(textOf(response.content ?? [])).slice(
    0,
    AI_PREVIEW_CARD_COUNT
  );
}

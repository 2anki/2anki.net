import type Anthropic from '@anthropic-ai/sdk';
import type { IChatMessagesRepository } from '../../data_layer/ChatMessagesRepository';
import type {
  ConversationWithMessages,
  IConversationsRepository,
} from '../../data_layer/ConversationsRepository';
import { recordClaudeUsage } from '../../lib/claude/recordClaudeUsage';
import { chatAttachmentKey } from '../../lib/storage/chatAttachmentKeys';
import type { IChatAttachmentsRepository } from '../../data_layer/ChatAttachmentsRepository';
import {
  buildAttachmentBlocks,
  isReplayableAttachmentMime,
  type ChatAttachment,
} from './buildAttachmentBlocks';
import {
  extractAttachmentText,
  buildAttachmentTextBlock,
} from './extractAttachmentText';
import {
  isChatCardTemplate,
  templatePromptSuffix,
  templateForbidsCloze,
  type ChatCardTemplate,
} from './chatTemplates';
import {
  looksLikeCloze,
  normalizeBasicCard,
  stripClozeFromStem,
} from './ChatDeckUseCase';

const REQUIRED_MCQ_OPTION_COUNT = 4;

const MCQ_PROMPT_ADDITION = `For multiple-choice cards with one correct answer, wrap them in the same JSON code block using:

\`\`\`json
[{"front": "question stem", "options": ["A", "B", "C", "D"], "correct_index": 0, "rationale": "why the correct option is right (optional)"}]
\`\`\`

Use exactly four options. correct_index is the 0-based position of the right option. Omit "back" on MCQ cards.`;

const MCQ_TOOL_NAME = 'emit_mcq_cards';

const MCQ_TOOL: Anthropic.Tool = {
  name: MCQ_TOOL_NAME,
  description:
    'Emit a set of multiple-choice flashcards. Every card must have a question stem, exactly four answer options, and the 0-based index of the correct option.',
  input_schema: {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            front: {
              type: 'string',
              description:
                'The question stem. Must NOT contain cloze deletion syntax like {{c1::...}}; if basing a question on a cloze sentence, replace the deleted span with a blank (_____).',
            },
            options: {
              type: 'array',
              description: 'Exactly four answer options',
              minItems: REQUIRED_MCQ_OPTION_COUNT,
              maxItems: REQUIRED_MCQ_OPTION_COUNT,
              items: { type: 'string' },
            },
            correct_index: {
              type: 'integer',
              minimum: 0,
              maximum: REQUIRED_MCQ_OPTION_COUNT - 1,
              description: '0-based index of the correct option',
            },
            rationale: {
              type: 'string',
              description:
                'Brief explanation of why the correct option is right',
            },
          },
          required: ['front', 'options', 'correct_index'],
        },
      },
    },
    required: ['cards'],
  },
};

const CLARIFY_TOOL_NAME = 'reply_without_cards';

// With the MCQ tool forced outright, a turn that cannot produce cards (missing
// attachment, ambiguous request) had no channel except a quiz card — prod
// showed a 1-card MCQ asking the user how to proceed (#4056). tool_choice
// "any" plus this escape tool keeps the structured-output guarantee for real
// card turns while letting the model answer like a person when it has to.
const CLARIFY_TOOL: Anthropic.Tool = {
  name: CLARIFY_TOOL_NAME,
  description:
    'Use ONLY when you cannot produce the requested multiple-choice cards this turn — for example a referenced file is missing or the request needs clarification. The message is shown to the user as a normal chat reply. Never use this to deliver card content.',
  input_schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The short reply shown to the user',
      },
    },
    required: ['message'],
  },
};

const MODEL = 'claude-sonnet-5';
const MAX_HISTORY_TURNS = 10;
// A follow-up turn replays the attachment text folded into its original user
// message, so a large PDF would otherwise be re-sent on every subsequent turn.
// The current turn still receives the full extracted text (up to
// extractAttachmentText's 200 000-char budget); only the copy carried forward
// as conversation memory is capped here.
const MAX_ATTACHMENT_TEXT_IN_HISTORY = 20_000;
// Sonnet 5's adaptive thinking spends from the same max_tokens budget as the
// visible reply, so both caps are doubled from their pre-Sonnet-5 values.
const MAX_TOKENS = 8192;
// MCQ is emitted as forced tool-use JSON (stem + 4 options + rationale per
// card). At 4096 the structured output truncates on multi-card batches, the
// tool input never closes, extraction returns nothing, and the turn fails with
// McqExtractionFailedError. Give the MCQ path more headroom so the JSON fits.
const MCQ_MAX_TOKENS = 16384;
const AUTO_TITLE_MAX_LENGTH = 60;

const STUDY_ASSISTANT_SYSTEM_PROMPT = `You are a study assistant for 2anki, a tool that turns notes into Anki flashcards.

Response style:
- Be concise. Lead with the answer or the cards, not a preamble.
- Do not restate the user's request. Do not say "Great question" or "I'd be happy to". Skip the wind-up.
- Hard budget: at most 6 short bullets OR 3 short paragraphs per reply. If the topic needs more, end with one line offering specific follow-ups ("Want more on history, economy, or culture?") and let the user pull.
- Skip section headings on short replies. Use them only when the user asks for a structured overview.
- No emoji fanfare. A single emoji is fine if it adds information (a flag for a country, a check for completion). Never decorate.
- When generating flashcards, the JSON code block is the answer. Keep any surrounding prose to one or two sentences max.

Help users understand material, answer study questions, and generate flashcards. When generating flashcards, you MUST wrap them in a JSON code block using EXACTLY this format:

\`\`\`json
[{"front": "question or term", "back": "answer or definition"}]
\`\`\`

For fill-in-the-blank or cloze cards, put the answer inline using Anki cloze syntax on the front and leave back empty:

\`\`\`json
[{"front": "The capital of France is {{c1::Paris}}.", "back": ""}]
\`\`\`

Use {{c1::...}}, {{c2::...}}, {{c3::...}} for separate blanks within the same card. Do not use bare ___ placeholders — the deck builder expects Anki cloze syntax for cloze cards.

Card fields may contain inline HTML (b, i, u, sub, sup, ruby, br). For furigana or other reading annotations, use complete ruby markup with the base text INSIDE the tag and the reading in <rt>: \`<ruby>三<rt>さん</rt></ruby>\`. Never write the base text outside the tag or omit <rt> (\`三<ruby>さん</ruby>\` is wrong and renders as plain text).

Never output raw JSON without the code fence. Always include the opening \`\`\`json and closing \`\`\` markers.

On the line immediately before the JSON code block, write \`Deck: <name>\` — a short, descriptive deck name (max 60 characters) for the cards, e.g. \`Deck: Cell Biology — Mitosis\`. Don't mention the deck name in the prose; that line is metadata, not conversation.

Supported input on 2anki:
- Best: Notion HTML export (.zip with toggles — toggles become front/back automatically)
- Also: Markdown (.md), CSV, plain HTML, .apkg (existing Anki decks), PDF, .docx, .pptx, .xlsx

Never recommend OCR, image-to-text tools, screenshots, or "describe what's in the image". 2anki does not extract text from images, and routing users there wastes their time.

If a user uploads or mentions an image, photo, screenshot, or scanned page: tell them 2anki works with text, not images. Give them two options — (1) export the source from Notion as HTML, or (2) type or paste the notes directly into chat and you'll generate cards from that. Pick one and move forward.

After any explanation, offer to turn it into flashcards if the user hasn't already asked. Keep responses focused — this is a study tool, not a general assistant.`;

export interface ChatCard {
  front: string;
  back: string;
  options?: string[];
  correctIndex?: number;
  rationale?: string;
  tags?: string[];
}

const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,23}$/;
const MAX_TAGS_PER_CARD = 8;

function parseTagsField(raw: unknown): string[] | undefined {
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

export interface ChatUser {
  owner: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SendMessageResult {
  content: string;
  conversationId: number;
  contentBefore?: string;
  contentAfter?: string;
  cards?: ChatCard[];
  /// Model-chosen deck name (see ExtractCardsResult.deckName). Only present
  /// when the turn produced cards.
  deckName?: string;
}

function buildAutoTitle(firstMessage: string): string {
  const trimmed = firstMessage.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return 'New conversation';
  if (trimmed.length <= AUTO_TITLE_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, AUTO_TITLE_MAX_LENGTH).trimEnd()}…`;
}

function capAttachmentTextForHistory(block: string): string {
  if (block.length <= MAX_ATTACHMENT_TEXT_IN_HISTORY) return block;
  return `${block.slice(0, MAX_ATTACHMENT_TEXT_IN_HISTORY)}\n[…truncated]`;
}

function foldAttachmentIntoContent(
  content: string,
  attachmentText: string | null
): string {
  if (attachmentText == null || attachmentText.length === 0) return content;
  return `${attachmentText}\n\n${content}`;
}

function textOfMessageContent(
  content: Anthropic.MessageParam['content']
): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');
}

export interface ExtractCardsResult {
  cards: ChatCard[] | undefined;
  contentBefore: string | undefined;
  contentAfter: string | undefined;
  /// Model-chosen deck name, parsed from a trailing `Deck: <name>` line in
  /// the prose before the JSON block (see the system prompt). Stripped from
  /// `contentBefore` so it never renders as conversation text.
  deckName: string | undefined;
}

/// Matches a `Deck: <name>` line at the very END of the (trimmed) prose that
/// precedes the JSON block. Anchored at end-of-string so a "Deck:" mention
/// mid-prose is left alone.
const DECK_NAME_LINE = /(?:^|\n)\s*Deck:\s*(.{1,80})$/i;

function splitDeckName(before: string): { deckName?: string; rest: string } {
  const match = DECK_NAME_LINE.exec(before);
  if (match == null) return { rest: before };
  const deckName = match[1].trim();
  if (deckName.length === 0) return { rest: before };
  return { deckName, rest: before.slice(0, match.index).trim() };
}

function asMcqChatCard(item: Record<string, unknown>): ChatCard | null {
  const front = item.front;
  if (typeof front !== 'string') return null;
  const options = item.options;
  if (!Array.isArray(options)) return null;
  if (options.length !== REQUIRED_MCQ_OPTION_COUNT) return null;
  if (
    !options.every(
      (opt): opt is string => typeof opt === 'string' && opt.trim().length > 0
    )
  ) {
    return null;
  }
  const correctIndex = item.correct_index;
  if (typeof correctIndex !== 'number' || !Number.isInteger(correctIndex))
    return null;
  if (correctIndex < 0 || correctIndex >= options.length) return null;
  const rationale = typeof item.rationale === 'string' ? item.rationale : '';
  return {
    front: stripClozeFromStem(front),
    back: '',
    options,
    correctIndex,
    ...(rationale.length > 0 ? { rationale } : {}),
  };
}

function parseCardItem(
  item: unknown,
  mcqAllowed: boolean,
  forbidCloze: boolean
): ChatCard | null {
  if (item == null || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const looksLikeMcq =
    record.options !== undefined || record.correct_index !== undefined;
  if (mcqAllowed && looksLikeMcq) {
    const mcq = asMcqChatCard(record);
    if (mcq == null) return null;
    const tags = parseTagsField(record.tags);
    return tags != null ? { ...mcq, tags } : mcq;
  }
  if (typeof record.front === 'string' && typeof record.back === 'string') {
    const tags = parseTagsField(record.tags);
    const base: ChatCard = {
      front: record.front,
      back: record.back,
      ...(tags != null ? { tags } : {}),
    };
    if (forbidCloze && looksLikeCloze(base.front)) {
      const normalized = normalizeBasicCard(base);
      return { ...base, front: normalized.front, back: normalized.back };
    }
    return base;
  }
  return null;
}

export function rewriteAssistantContentWithTaggedCards(
  content: string,
  taggedCards: ChatCard[]
): string {
  const fencedMatch = /```json\s*([\s\S]*?)```/.exec(content);
  if (fencedMatch != null) {
    const jsonArray = JSON.stringify(taggedCards);
    return `${content.slice(0, fencedMatch.index)}\`\`\`json\n${jsonArray}\n\`\`\`${content.slice(fencedMatch.index + fencedMatch[0].length)}`;
  }
  const rawMatch = /((?:^|\n)\s*)(\[\s*\{[\s\S]*\}\s*\])/.exec(content);
  if (rawMatch != null) {
    const jsonArray = JSON.stringify(taggedCards);
    return `${content.slice(0, rawMatch.index + rawMatch[1].length)}${jsonArray}${content.slice(rawMatch.index + rawMatch[0].length)}`;
  }
  return content;
}

function parseCardArray(
  raw: string,
  mcqAllowed: boolean,
  forbidCloze: boolean
): ChatCard[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const cards: ChatCard[] = [];
  for (const item of parsed) {
    const card = parseCardItem(item, mcqAllowed, forbidCloze);
    if (card != null) cards.push(card);
  }
  return cards.length > 0 ? cards : undefined;
}

/// The model writes `Format: cloze` on its own line before the JSON block
/// when it honors an explicit cloze request on a non-cloze note type (see
/// the template suffixes). The declaration lifts the stray-cloze
/// normalization for that reply and never renders as conversation text.
const FORMAT_CLOZE_LINE = /(?:^|\n)[ \t]*Format:[ \t]*cloze[ \t]*(?=\n|$)/i;

function stripFormatLine(before: string): string {
  return before.replace(FORMAT_CLOZE_LINE, '').trim();
}

export function extractCards(
  text: string,
  mcqAllowed = false,
  forbidCloze = false
): ExtractCardsResult {
  const effectiveForbidCloze = forbidCloze && !FORMAT_CLOZE_LINE.test(text);
  const fencedMatch = /```json\s*([\s\S]*?)```/.exec(text);
  if (fencedMatch != null) {
    const cards = parseCardArray(
      fencedMatch[1],
      mcqAllowed,
      effectiveForbidCloze
    );
    if (cards != null) {
      const before = text.slice(0, fencedMatch.index).trim();
      const after = text
        .slice(fencedMatch.index + fencedMatch[0].length)
        .trim();
      const { deckName, rest } = splitDeckName(stripFormatLine(before));
      return {
        cards,
        contentBefore: rest.length > 0 ? rest : undefined,
        contentAfter: after.length > 0 ? after : undefined,
        deckName,
      };
    }
  }

  const rawMatch = /((?:^|\n)\s*)(\[\s*\{[\s\S]*\}\s*\])/.exec(text);
  if (rawMatch != null) {
    const cards = parseCardArray(rawMatch[2], mcqAllowed, effectiveForbidCloze);
    if (cards != null) {
      const before = text.slice(0, rawMatch.index).trim();
      const after = text.slice(rawMatch.index + rawMatch[0].length).trim();
      const { deckName, rest } = splitDeckName(stripFormatLine(before));
      return {
        cards,
        contentBefore: rest.length > 0 ? rest : undefined,
        contentAfter: after.length > 0 ? after : undefined,
        deckName,
      };
    }
  }

  return {
    cards: undefined,
    contentBefore: undefined,
    contentAfter: undefined,
    deckName: undefined,
  };
}

export class ChatConversationNotFoundError extends Error {
  constructor() {
    super('Conversation not found');
    this.name = 'ChatConversationNotFoundError';
  }
}

export class McqExtractionFailedError extends Error {
  constructor() {
    super('Could not produce multiple-choice cards');
    this.name = 'McqExtractionFailedError';
  }
}

export class ChatAttachmentsNotReplayableError extends Error {
  constructor() {
    super('Attached files cannot be replayed');
    this.name = 'ChatAttachmentsNotReplayableError';
  }
}

type ReplayTurn = ConversationWithMessages['messages'][number];

function selectReplayTurns(
  messages: ReplayTurn[],
  excludeMessageId: number | undefined
): { historyHead: ReplayTurn[]; lastTurn: ReplayTurn | null } {
  const prior = messages.filter((m) => m.id !== excludeMessageId);
  const lastUserIndex = prior.map((m) => m.role).lastIndexOf('user');
  const upToLastUser =
    lastUserIndex >= 0 ? prior.slice(0, lastUserIndex + 1) : prior;
  const recent = upToLastUser.slice(-(MAX_HISTORY_TURNS + 1));
  return {
    historyHead: recent.slice(0, -1),
    lastTurn: recent[recent.length - 1] ?? null,
  };
}

function mcqCardToWireShape(card: ChatCard): Record<string, unknown> {
  return {
    front: card.front,
    options: card.options ?? [],
    correct_index: card.correctIndex ?? 0,
    ...(card.rationale != null && card.rationale.length > 0
      ? { rationale: card.rationale }
      : {}),
    ...(card.tags != null && card.tags.length > 0 ? { tags: card.tags } : {}),
  };
}

export function embedMcqCardsAsJsonBlock(
  prose: string,
  cards: ChatCard[]
): string {
  const jsonArray = JSON.stringify(cards.map(mcqCardToWireShape));
  const block = `\`\`\`json\n${jsonArray}\n\`\`\``;
  const trimmedProse = prose.trim();
  return trimmedProse.length > 0 ? `${trimmedProse}\n\n${block}` : block;
}

export function extractMcqCardsFromToolUse(
  content: Anthropic.ContentBlock[]
): ChatCard[] | undefined {
  const toolBlock = content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === MCQ_TOOL_NAME
  );
  if (toolBlock == null) return undefined;
  const input = toolBlock.input;
  if (input == null || typeof input !== 'object') return undefined;
  const rawCards = (input as Record<string, unknown>).cards;
  if (!Array.isArray(rawCards)) return undefined;
  const cards: ChatCard[] = [];
  for (const item of rawCards) {
    if (item == null || typeof item !== 'object') continue;
    const mcq = asMcqChatCard(item as Record<string, unknown>);
    if (mcq != null) cards.push(mcq);
  }
  return cards.length > 0 ? cards : undefined;
}

export function extractClarifyMessageFromToolUse(
  content: Anthropic.ContentBlock[]
): string | undefined {
  const toolBlock = content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === CLARIFY_TOOL_NAME
  );
  if (toolBlock == null) return undefined;
  const input = toolBlock.input;
  if (input == null || typeof input !== 'object') return undefined;
  const message = (input as Record<string, unknown>).message;
  if (typeof message !== 'string' || message.trim().length === 0) {
    return undefined;
  }
  return message.trim();
}

export interface IChatAttachmentBlobStorage {
  uploadFile(name: string, data: Buffer | string): Promise<void>;
  getFileContents(key: string): Promise<{ Body: Buffer | undefined }>;
}

export class ChatUseCase {
  constructor(
    private readonly messagesRepo: IChatMessagesRepository,
    private readonly conversationsRepo: IConversationsRepository,
    private readonly anthropic: Anthropic,
    private readonly attachmentsRepo?: IChatAttachmentsRepository,
    private readonly attachmentStorage?: IChatAttachmentBlobStorage
  ) {}

  async execute(input: {
    user: ChatUser;
    content: string;
    conversationHistory: ChatMessage[];
    conversationId?: number | null;
    onToken?: (text: string) => void;
    attachments?: ChatAttachment[];
    templateSlug?: string | null;
  }): Promise<SendMessageResult> {
    const { user, content, conversationHistory, onToken } = input;
    const attachments = input.attachments ?? [];

    let conversationId: number;
    if (input.conversationId != null) {
      const existing = await this.conversationsRepo.findForUser({
        userId: user.owner,
        conversationId: input.conversationId,
      });
      if (existing == null) {
        throw new ChatConversationNotFoundError();
      }
      conversationId = existing.id;
    } else {
      conversationId = await this.conversationsRepo.create({
        userId: user.owner,
        title: buildAutoTitle(content),
      });
    }

    const attachmentBlocks = buildAttachmentBlocks(attachments);
    const extractedText = await extractAttachmentText(attachments);
    const attachmentTextBlock = buildAttachmentTextBlock(extractedText);
    const promptText =
      attachmentTextBlock.length > 0
        ? `${attachmentTextBlock}\n\n${content}`
        : content;
    const userContent: Anthropic.MessageParam['content'] =
      attachmentBlocks.length > 0
        ? [...attachmentBlocks, { type: 'text', text: promptText }]
        : promptText;

    const historyMessages = await this.assembleHistory({
      userId: user.owner,
      conversationId,
      isExistingConversation: input.conversationId != null,
      clientHistory: conversationHistory,
    });

    const userMessageId = await this.messagesRepo.insert({
      userId: user.owner,
      conversationId,
      role: 'user',
      content,
      attachmentText:
        attachmentTextBlock.length > 0
          ? capAttachmentTextForHistory(attachmentTextBlock)
          : null,
      hadBinaryAttachments: attachmentBlocks.length > 0,
    });

    const result = await this.streamAssistantTurn({
      user,
      conversationId,
      templateSlug: input.templateSlug,
      historyMessages,
      userContent,
      onToken,
    });

    await this.persistTurnAttachments({
      userId: user.owner,
      conversationId,
      messageId: userMessageId,
      attachments,
    });

    return result;
  }

  // Best-effort by design: a failed upload degrades regenerate on this turn
  // to the honest refusal, but must never fail a turn the user already got.
  private async persistTurnAttachments(input: {
    userId: number;
    conversationId: number;
    messageId: number;
    attachments: ChatAttachment[];
  }): Promise<void> {
    if (this.attachmentsRepo == null || this.attachmentStorage == null) return;
    const binaries = input.attachments.filter((attachment) =>
      isReplayableAttachmentMime(attachment.mimeType)
    );
    if (binaries.length === 0) return;
    try {
      const rows = [];
      for (const [index, attachment] of binaries.entries()) {
        const key = chatAttachmentKey({
          userId: input.userId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          index,
          filename: attachment.fileName ?? 'attachment',
        });
        await this.attachmentStorage.uploadFile(key, attachment.data);
        rows.push({
          userId: input.userId,
          messageId: input.messageId,
          s3Key: key,
          filename: attachment.fileName ?? 'attachment',
          contentType: attachment.mimeType,
          byteSize: attachment.data.length,
        });
      }
      await this.attachmentsRepo.insertMany(rows);
    } catch (error) {
      console.error('[chat] attachment persistence failed', error);
    }
  }

  private async loadReplayAttachments(input: {
    userId: number;
    messageId: number;
  }): Promise<ChatAttachment[] | null> {
    if (this.attachmentsRepo == null || this.attachmentStorage == null) {
      return null;
    }
    const rows = await this.attachmentsRepo.listForMessage(input);
    if (rows.length === 0) return null;
    const attachments: ChatAttachment[] = [];
    for (const row of rows) {
      let body: Buffer | undefined;
      try {
        body = (await this.attachmentStorage.getFileContents(row.s3Key)).Body;
      } catch {
        body = undefined;
      }
      if (body == null) {
        await this.attachmentsRepo.deleteForMessage(input);
        return null;
      }
      attachments.push({
        mimeType: row.contentType,
        data: body,
        fileName: row.filename,
      });
    }
    return attachments;
  }

  private async assembleHistory(input: {
    userId: number;
    conversationId: number;
    isExistingConversation: boolean;
    clientHistory: ChatMessage[];
  }): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    if (input.isExistingConversation) {
      const persisted = await this.messagesRepo.listForConversation({
        userId: input.userId,
        conversationId: input.conversationId,
      });
      return persisted.slice(-MAX_HISTORY_TURNS).map((m) => ({
        role: m.role,
        content: foldAttachmentIntoContent(m.content, m.attachmentText),
      }));
    }
    return input.clientHistory
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  async regenerate(input: {
    user: ChatUser;
    conversationId: number;
    templateSlug?: string | null;
    onToken?: (text: string) => void;
  }): Promise<SendMessageResult> {
    const { user, onToken } = input;

    const conversation = await this.conversationsRepo.findForUser({
      userId: user.owner,
      conversationId: input.conversationId,
    });
    if (conversation == null) {
      throw new ChatConversationNotFoundError();
    }

    const latestAssistant =
      await this.messagesRepo.findLatestAssistantInConversation({
        userId: user.owner,
        conversationId: conversation.id,
      });

    const { historyHead, lastTurn } = selectReplayTurns(
      conversation.messages,
      latestAssistant?.id
    );

    const foldedLastTurnText =
      lastTurn != null
        ? foldAttachmentIntoContent(lastTurn.content, lastTurn.attachmentText)
        : '';
    let userContent: Anthropic.MessageParam['content'] = foldedLastTurnText;
    if (lastTurn?.hadBinaryAttachments) {
      const replayed = await this.loadReplayAttachments({
        userId: user.owner,
        messageId: lastTurn.id,
      });
      if (replayed == null) {
        throw new ChatAttachmentsNotReplayableError();
      }
      userContent = [
        ...buildAttachmentBlocks(replayed),
        { type: 'text', text: foldedLastTurnText },
      ];
    }

    if (latestAssistant != null) {
      await this.messagesRepo.deleteById({
        userId: user.owner,
        messageId: latestAssistant.id,
      });
    }

    return this.streamAssistantTurn({
      user,
      conversationId: conversation.id,
      templateSlug: input.templateSlug,
      historyMessages: historyHead.map((m) => ({
        role: m.role,
        content: foldAttachmentIntoContent(m.content, m.attachmentText),
      })),
      userContent,
      onToken,
    });
  }

  private async streamAssistantTurn(params: {
    user: ChatUser;
    conversationId: number;
    templateSlug?: string | null;
    historyMessages: Array<{
      role: 'user' | 'assistant';
      content: Anthropic.MessageParam['content'];
    }>;
    userContent: Anthropic.MessageParam['content'];
    onToken?: (text: string) => void;
  }): Promise<SendMessageResult> {
    const { user, conversationId, historyMessages, userContent, onToken } =
      params;

    const resolvedTemplate: ChatCardTemplate = isChatCardTemplate(
      params.templateSlug
    )
      ? params.templateSlug
      : 'basic';
    const mcqForced = resolvedTemplate === 'mcq';

    const templateSuffix = templatePromptSuffix(resolvedTemplate);
    const baseSystemPrompt = `${STUDY_ASSISTANT_SYSTEM_PROMPT}\n\n${MCQ_PROMPT_ADDITION}`;
    const systemPromptText =
      templateSuffix.length > 0
        ? `${baseSystemPrompt}\n\n${templateSuffix.trim()}`
        : baseSystemPrompt;

    const messages: Anthropic.MessageParam[] = [
      ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ];

    const stream = this.anthropic.messages.stream({
      model: MODEL,
      max_tokens: mcqForced ? MCQ_MAX_TOKENS : MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: systemPromptText,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages,
      ...(mcqForced
        ? {
            tools: [MCQ_TOOL, CLARIFY_TOOL],
            tool_choice: { type: 'any' },
          }
        : {}),
    });

    if (onToken != null) {
      stream.on('text', onToken);
    }

    const finalMessage = await stream.finalMessage();
    recordClaudeUsage({
      surface: 'chat',
      model: finalMessage.model,
      usage: finalMessage.usage,
      userId: user.owner,
    });

    const assistantContent = finalMessage.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (mcqForced) {
      const mcqCards = extractMcqCardsFromToolUse(finalMessage.content);
      if (mcqCards == null) {
        const clarification = extractClarifyMessageFromToolUse(
          finalMessage.content
        );
        if (clarification != null) {
          await this.persistAssistantTurn(
            user.owner,
            conversationId,
            clarification
          );
          return { content: clarification, conversationId };
        }
        throw new McqExtractionFailedError();
      }
      const persistedContent = embedMcqCardsAsJsonBlock(
        assistantContent,
        mcqCards
      );
      await this.persistAssistantTurn(
        user.owner,
        conversationId,
        persistedContent
      );
      return {
        content: persistedContent,
        conversationId,
        cards: mcqCards,
      };
    }

    await this.persistAssistantTurn(
      user.owner,
      conversationId,
      assistantContent
    );

    const userAskedCloze = /\bcloze\b/i.test(
      textOfMessageContent(params.userContent)
    );
    const forbidCloze =
      templateForbidsCloze(resolvedTemplate) && !userAskedCloze;
    if (userAskedCloze && templateForbidsCloze(resolvedTemplate)) {
      console.info('[chat] honoring cloze request over note type', {
        template: resolvedTemplate,
      });
    }
    const { cards, contentBefore, contentAfter, deckName } = extractCards(
      assistantContent,
      true,
      forbidCloze
    );

    return {
      content: assistantContent,
      conversationId,
      ...(cards != null ? { cards } : {}),
      ...(contentBefore != null ? { contentBefore } : {}),
      ...(contentAfter != null ? { contentAfter } : {}),
      ...(deckName != null ? { deckName } : {}),
    };
  }

  private async persistAssistantTurn(
    userId: number,
    conversationId: number,
    content: string
  ): Promise<void> {
    await this.messagesRepo.insert({
      userId,
      conversationId,
      role: 'assistant',
      content,
    });
    await this.conversationsRepo.touch({ userId, conversationId });
    await this.conversationsRepo.saveDraft({
      userId,
      conversationId,
      content: null,
    });
  }
}

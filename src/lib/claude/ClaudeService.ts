import type Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { jsonrepair } from 'jsonrepair';
import { detect } from '../cardStyle/headingDriven/detect';
import { splitByHeadings } from '../cardStyle/headingDriven/splitByHeadings';
import { getCardStylePromptFragment } from './getCardStylePromptFragment';
import { ANKI_MATH_FRAGMENT } from './ankiMathFragment';
import { recordClaudeUsage } from './recordClaudeUsage';
import { computeUsageCostUsd } from './pricing';
import { getCardSizePromptSuffix, validateCardSize } from './cardSize';

export interface FieldMappingEntry {
  name: string;
  instruction: string;
}

export interface FieldMapping {
  templateName: string;
  fields: FieldMappingEntry[];
}

export function buildFieldMappingPromptFragment(
  fieldMapping: FieldMapping | undefined
): string {
  if (fieldMapping == null || fieldMapping.fields.length === 0) return '';
  const lines = fieldMapping.fields.map(
    (f) => `  - ${f.name}: ${f.instruction}`
  );
  return `Target template: ${fieldMapping.templateName}\nField mapping (emit exactly these keys in each card's "fields" object):\n${lines.join('\n')}`;
}

export const SYSTEM_PROMPT = `
You are an Anki flashcard generator. Output ONLY a compact JSON array.

Format (nothing else — no markdown, no explanation):
[{"deck":"Deck Name","cards":[{"q":"front HTML","a":"back HTML"}]}]

Optional card fields (omit when not applicable):
- "tags": string[]    — topic tags
- "cloze": true       — only when front contains {{c1::...}} syntax
- "media": string[]   — only local filenames that appear in the Available media files list

Extraction rules:
- HTML <details>/<summary>: <summary> text = q, sibling content = a
- Heading followed by paragraph: heading = q, paragraph = a
- Bold term + definition: term = q, definition = a
- Inline <code> in q: rewrite as {{c1::code}} and set "cloze": true
- Preserve HTML formatting in q and a
- Never invent content — only use text present in the document

Minimum-information rules (one fact per card):
- Each card must hold one fact, definition, or concept — never multiple facts bundled together
- Split a paragraph that states multiple facts into one card per fact
- A table of N rows produces N cards (one row per card)
- One definition with its example may stay on a single card
- Cloze cards are already single-fact — do not split them
- If the user's additional instructions explicitly ask for detailed or longer cards, defer to those instructions over these rules. The Card size directive in the user message overrides these rules the same way.

Card density — extract ALL cards the content supports:
- Do not stop early; work through the entire input before emitting the array
- Every heading, term, definition, table row, list item, and detail block is a card candidate
- Aim for maximum coverage: a 5-page chapter should yield 40–80 cards, not 10–20
- The Card size directive sets how much belongs on each card; when density and card size conflict, prefer fuller cards over more cards

${ANKI_MATH_FRAGMENT}
`.trim();

export const EMPTY_CONTENT_USER_MESSAGE =
  "Claude couldn't find any content to turn into flashcards in this Notion page. The page looks empty or only contains layout elements like buttons or placeholders. Try adding headings with explanations, toggle lists, or question-and-answer text, then convert again.";

export const LARGE_SECTION_USER_MESSAGE =
  "Couldn't finish converting a large section of this page. Try converting a smaller part, or split the page and convert each part separately.";

export const IMAGE_ONLY_USER_MESSAGE =
  "This file only contains images — there's no text to turn into cards. Export your notes with text, or paste the text directly, then convert again.";

const MIN_TEXT_CHARS_FOR_CONVERSION = 2;

export function isImageOnlyContent(html: string): boolean {
  const $ = cheerio.load(html);
  $('style, script, head, link[rel="stylesheet"]').remove();
  const hasImages = $('img').length > 0;
  if (!hasImages) return false;
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return text.length < MIN_TEXT_CHARS_FOR_CONVERSION;
}

const EMPTY_CONTENT_SIGNALS = [
  'no actual',
  'no extractable',
  'no flashcard',
  'no question',
  'nothing to convert',
  "couldn't find",
  'cannot find',
  'unable to find',
  'no q&a',
  'no q/a',
  'consists only of',
  'i need to see',
  'need to see the',
  'please provide the',
  'provide the content',
  'share the content',
  'no content was provided',
];

export function looksLikeEmptyContentExplanation(cleaned: string): boolean {
  const lower = cleaned.toLowerCase();
  return EMPTY_CONTENT_SIGNALS.some((signal) => lower.includes(signal));
}

function causeMessage(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  return undefined;
}

function causeCode(err: unknown): string | undefined {
  if (err instanceof Error && 'code' in err)
    return String((err as NodeJS.ErrnoException).code);
  return undefined;
}

// Every chunk gets the same output ceiling. It used to scale with the chunk's
// own byte count, which meant a truncated chunk's halves could land under the
// threshold and retry at HALF the budget the parent already overran — a tighter
// budget per byte than the call that failed. max_tokens is a cap, not a charge:
// output is billed on tokens actually generated, so a uniform ceiling costs
// nothing and removes the retry's worst case.
const CHUNK_MAX_TOKENS = 16384;

const MAX_CHUNK_API_ATTEMPTS = 2;
const CHUNK_RETRY_BASE_DELAY_MS = 500;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A chunk request can drop mid-stream (the Anthropic SDK does not auto-retry a
// stream that fails after it started) or hit a transient gateway/overload. These
// are worth one more attempt; auth/validation/4xx errors are not.
export function isTransientChunkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const ctor = error.constructor?.name;
  if (ctor === 'APIConnectionError' || ctor === 'APIConnectionTimeoutError') {
    return true;
  }
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') {
    return (
      status === 408 ||
      status === 409 ||
      status === 429 ||
      status === 529 ||
      status >= 500
    );
  }
  return false;
}

function deterministicId(input: string): number {
  const hex = createHash('sha1').update(input).digest('hex').slice(0, 13);
  return Number.parseInt(hex, 16) % 1e13;
}

function extractStyleFromHtml(html: string): string {
  const $ = cheerio.load(html);
  const raw = $('style')
    .map((_, el) => $(el).html() ?? '')
    .get()
    .join('\n');
  return raw
    .replaceAll('white-space: pre-wrap;', '')
    .replaceAll('list-style-type: none;', '');
}

function stripHtmlBoilerplate(html: string): string {
  const $ = cheerio.load(html);
  $('style, script, head, link[rel="stylesheet"]').remove();
  const body = $('body');
  return body.length ? (body.html() ?? '') : $.html();
}

interface CompactCard {
  q: string;
  a: string;
  tags?: string[];
  cloze?: boolean;
  media?: string[];
}

interface CompactDeck {
  deck: string;
  cards: CompactCard[];
}

export interface DeckInfo {
  name: string;
  image: string;
  style: null | string;
  id: number;
  settings: Record<string, unknown>;
  cards: CardInfo[];
}

export interface CardInfo {
  name: string;
  back: string;
  tags: string[];
  cloze: boolean;
  number: number;
  enableInput: boolean;
  answer: string;
  media: string[];
  chunkIndex?: number;
}

export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32);
}

function resolveMediaPath(
  claudePath: string,
  availableMediaFiles: string[]
): string {
  const normalized = claudePath.replaceAll('\\', '/');
  if (availableMediaFiles.includes(normalized)) return normalized;
  const filename = normalized.split('/').pop() ?? normalized;
  const match = availableMediaFiles.find((f) =>
    f.replaceAll('\\', '/').endsWith('/' + filename)
  );
  return match ?? normalized;
}

function stripPathsFromCardHtml(html: string): string {
  const $ = cheerio.load(html);
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    if (!src.startsWith('http://') && !src.startsWith('https://')) {
      const filename = decodeURIComponent(src).split('/').pop() ?? src;
      $(el).attr('src', filename);
    }
  });
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (!href.startsWith('http://') && !href.startsWith('https://')) {
      const filename = decodeURIComponent(href).split('/').pop() ?? href;
      $(el).attr('href', filename);
    }
  });
  const body = $('body');
  return body.length ? (body.html() ?? html) : html;
}

const AUDIO_EXTENSIONS = /\.(mp3|ogg|oga|opus|wav|flac|m4a|aac)$/i;

function isLocalAudioHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith('http://') || href.startsWith('https://')) return false;
  return AUDIO_EXTENSIONS.test(href);
}

interface AudioRewriteResult {
  back: string;
  audioFilenames: string[];
}

export function rewriteAudioAnchors(back: string): AudioRewriteResult {
  const $ = cheerio.load(back);
  const audioFilenames: string[] = [];
  let mutated = false;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (!isLocalAudioHref(href)) return;
    const filename = decodeURIComponent(href).split('/').pop() ?? href;
    if (!audioFilenames.includes(filename)) audioFilenames.push(filename);
    const figure = $(el).closest('figure');
    if (figure.length) {
      figure.remove();
    } else {
      $(el).remove();
    }
    mutated = true;
  });
  if (!mutated) return { back, audioFilenames };
  const body = $('body');
  const stripped = body.length ? (body.html() ?? back) : back;
  const tokens = audioFilenames.map((name) => `[sound:${name}]`).join('');
  return { back: stripped + tokens, audioFilenames };
}

export function expandCompactDeckInfo(
  compact: CompactDeck[],
  availableMediaFiles: string[],
  style: string | null
): DeckInfo[] {
  return compact.map((d) => ({
    name: d.deck,
    image: '',
    style,
    id: deterministicId(d.deck),
    settings: {
      template: 'specialstyle',
      clozeModelName: 'n2a-cloze',
      basicModelName: 'n2a-basic',
      inputModelName: 'n2a-input',
      useNotionId: true,
    },
    cards: d.cards.map((c) => {
      const { back: rewrittenBack, audioFilenames } = rewriteAudioAnchors(
        stripPathsFromCardHtml(c.a ?? '')
      );
      const declaredMedia = (c.media ?? []).map((m) =>
        resolveMediaPath(m, availableMediaFiles)
      );
      const audioMedia = audioFilenames.map((name) =>
        resolveMediaPath(name, availableMediaFiles)
      );
      const media = Array.from(new Set([...declaredMedia, ...audioMedia]));
      return {
        name: stripPathsFromCardHtml(c.q),
        back: rewrittenBack,
        tags: (c.tags ?? []).map(normalizeTag).filter((t) => t.length > 0),
        cloze: c.cloze ?? false,
        number: 0,
        enableInput: false,
        answer: '',
        notionId: deterministicId(c.q),
        media,
      };
    }),
  }));
}

let _anthropicClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!_anthropicClient) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AnthropicClass = require('@anthropic-ai/sdk').default;
    _anthropicClient = new AnthropicClass({
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
    }) as Anthropic;
    console.log('[Claude] Client initialised', {
      apiKeySet: !!process.env.ANTHROPIC_API_KEY,
    });
  }
  return _anthropicClient as Anthropic;
}

const CHUNK_SIZE = 40_000;

function chunkHtmlByDetails(html: string): string[] {
  if (html.length <= CHUNK_SIZE) return [html];

  const chunks: string[] = [];
  let offset = 0;

  while (offset < html.length) {
    if (offset + CHUNK_SIZE >= html.length) {
      chunks.push(html.slice(offset));
      break;
    }

    let splitAt = html.lastIndexOf('</details>', offset + CHUNK_SIZE);
    if (splitAt <= offset) {
      splitAt = offset + CHUNK_SIZE;
    } else {
      splitAt += '</details>'.length;
    }

    chunks.push(html.slice(offset, splitAt));
    offset = splitAt;
  }

  return chunks;
}

function splitChunkInHalf(html: string): string[] {
  if (html.length < 2) return [html];

  const mid = Math.floor(html.length / 2);
  const detailsBoundary = html.indexOf('</details>', mid);
  const splitAt =
    detailsBoundary >= 0 && detailsBoundary + '</details>'.length < html.length
      ? detailsBoundary + '</details>'.length
      : mid;

  return [html.slice(0, splitAt), html.slice(splitAt)];
}

function normalizeCardText(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function cardDedupeKey(card: Pick<CardInfo, 'name' | 'back'>): string {
  return `${normalizeCardText(card.name)}\0${normalizeCardText(card.back)}`;
}

// Keyed on front AND back, not front alone. A table with columns produces one
// card per column from a single row, and those cards naturally share the row's
// key term as their front — front-only dedup dropped every column after the
// first, silently, which is the "only the first few columns become cards"
// report (#3849). Two cards with the same front and different backs are
// distinct facts and both survive; only a genuine duplicate, same front and
// same back — a chunk boundary re-emitting a card — collapses. Dropping fewer
// cards is the safe direction here: a surviving near-duplicate is visible and
// Anki dedupes identical notes on import anyway, whereas a dropped column is
// content the user never sees.
export function dedupeIdenticalCards(decks: DeckInfo[]): DeckInfo[] {
  return decks.map((deck) => {
    const seen = new Set<string>();
    const dedupedCards = deck.cards.filter((card) => {
      const key = cardDedupeKey(card);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const removed = deck.cards.length - dedupedCards.length;
    if (removed > 0) {
      console.warn('[Claude] dedupeIdenticalCards', {
        deckName: deck.name,
        removed,
      });
    }
    return { ...deck, cards: dedupedCards };
  });
}

export function mergeDeckInfoArrays(decks: DeckInfo[]): DeckInfo[] {
  const byName = new Map<string, DeckInfo>();
  for (const deck of decks) {
    const existing = byName.get(deck.name);
    if (existing) {
      existing.cards.push(...deck.cards);
    } else {
      byName.set(deck.name, { ...deck, cards: [...deck.cards] });
    }
  }
  return dedupeIdenticalCards(Array.from(byName.values()));
}

export function buildUserMessage(
  strippedContent: string,
  availableMediaFiles: string[],
  userInstructions: string | undefined,
  cardStyleFragment: string,
  cardSize?: string,
  fieldMapping?: FieldMapping
): string {
  const mediaFilesList =
    availableMediaFiles.length > 0
      ? `\n\nAvailable local media files:\n${availableMediaFiles.map((f) => `- ${f}`).join('\n')}`
      : '';

  const instructionsSection = userInstructions?.trim()
    ? `\n\nAdditional instructions:\n${userInstructions.trim()}`
    : '';

  const fieldMappingFragment = buildFieldMappingPromptFragment(fieldMapping);
  const fieldMappingSection =
    fieldMappingFragment.length > 0
      ? `\n\nField mapping:\n${fieldMappingFragment}`
      : '';

  const styleSection =
    cardStyleFragment.length > 0 ? `\n\nCard style: ${cardStyleFragment}` : '';

  const sizeSuffix = getCardSizePromptSuffix(cardSize);
  const sizeSection = sizeSuffix.length > 0 ? `\n\n${sizeSuffix}` : '';

  return `Convert this HTML content into the compact deck JSON:\n\n${strippedContent}${mediaFilesList}${instructionsSection}${fieldMappingSection}${styleSection}${sizeSection}`;
}

export function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  if (start === -1) return null;
  const end = text.lastIndexOf(']');
  if (end < start) return null;
  return text.slice(start, end + 1);
}

type RedactedPayload = {
  length: number;
  prefix: string;
  sha256_prefix: string;
};

function redactClaudePayload(text: string): RedactedPayload {
  return {
    length: text.length,
    prefix: text.slice(0, 80),
    sha256_prefix: createHash('sha256').update(text).digest('hex').slice(0, 12),
  };
}

export class ClaudeParseError extends Error {
  constructor() {
    super('claude_parse_failed');
    this.name = 'ClaudeParseError';
  }
}

export class ClaudeLargeSectionError extends Error {
  constructor() {
    super(LARGE_SECTION_USER_MESSAGE);
    this.name = 'ClaudeLargeSectionError';
  }
}

export class ImageOnlyContentError extends Error {
  constructor() {
    super(IMAGE_ONLY_USER_MESSAGE);
    this.name = 'ImageOnlyContentError';
  }
}

export class ClaudeTruncatedError extends Error {
  constructor(readonly chunkContent: string) {
    super('claude_response_truncated');
    this.name = 'ClaudeTruncatedError';
  }
}

const STRAY_CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

function escapeStrayControlChars(text: string): string {
  return text.replace(STRAY_CONTROL_CHARS, (ch) => {
    const code = ch.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${code}`;
  });
}

function hasUsableCard(candidate: unknown[]): boolean {
  return candidate.some((deck) => {
    if (!deck || typeof deck !== 'object') return false;
    const cards = (deck as { cards?: unknown }).cards;
    if (!Array.isArray(cards)) return false;
    return cards.some((card) => {
      if (!card || typeof card !== 'object') return false;
      const q = (card as { q?: unknown }).q;
      const a = (card as { a?: unknown }).a;
      const cloze = (card as { cloze?: unknown }).cloze;
      const hasQ = typeof q === 'string' && q.length > 0;
      const hasA = typeof a === 'string' && a.length > 0;
      return hasQ && (hasA || cloze === true);
    });
  });
}

// jsonrepair mis-tokenizes an unescaped ASCII " inside a string value when the
// prose after it contains a colon or comma followed by non-JSON text (German
// „quote" pairs closed with ASCII " — the recurring jsonrepair-threw prod
// shape). Walk the text tracking string state and escape a closing " only when
// what follows cannot be the next JSON token.
function skipWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

function isJsonValueStart(ch: string | undefined): boolean {
  return ch === '"' || ch === '{' || ch === '[' || /[0-9tfn-]/.test(ch ?? '');
}

function quoteClosesString(text: string, quoteIndex: number): boolean {
  const j = skipWhitespace(text, quoteIndex + 1);
  const next = text[j];
  if (next === undefined || next === '}' || next === ']') return true;
  if (next !== ':' && next !== ',') return false;
  return isJsonValueStart(text[skipWhitespace(text, j + 1)]);
}

function escapeUnterminatedInnerQuotes(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString && c === '\\') {
      out += c + (text[i + 1] ?? '');
      i++;
      continue;
    }
    if (c !== '"') {
      out += c;
      continue;
    }
    if (!inString) {
      inString = true;
      out += c;
    } else if (quoteClosesString(text, i)) {
      inString = false;
      out += c;
    } else {
      out += String.raw`\"`;
    }
  }
  return out;
}

function repairAndParse(toParse: string): unknown {
  const escaped = escapeStrayControlChars(toParse);
  try {
    return JSON.parse(jsonrepair(escaped));
  } catch {
    return JSON.parse(jsonrepair(escapeUnterminatedInnerQuotes(escaped)));
  }
}

function tryRepairDeckArray(toParse: string): unknown[] | null {
  let candidate: unknown;
  try {
    candidate = repairAndParse(toParse);
  } catch {
    return null;
  }
  if (!Array.isArray(candidate) || candidate.length === 0) return null;
  return hasUsableCard(candidate) ? candidate : null;
}

export type RepairFailureReason =
  | 'jsonrepair-threw'
  | 'not-array'
  | 'empty-array'
  | 'no-usable-card'
  | 'recoverable';

// Classifies why a response could not be salvaged, so the rare unrecoverable
// case leaves a diagnosable log line instead of an opaque claude_parse_failed.
export function describeRepairFailure(toParse: string): RepairFailureReason {
  let candidate: unknown;
  try {
    candidate = repairAndParse(toParse);
  } catch {
    return 'jsonrepair-threw';
  }
  if (!Array.isArray(candidate)) return 'not-array';
  if (candidate.length === 0) return 'empty-array';
  return hasUsableCard(candidate) ? 'recoverable' : 'no-usable-card';
}

function sanitizeCompactDecks(
  parsed: unknown[],
  chunkIndex: number
): CompactDeck[] {
  let droppedDecks = 0;
  let droppedCards = 0;

  const decks: CompactDeck[] = [];
  for (const entry of parsed) {
    const d = entry as Partial<CompactDeck> | null;
    if (typeof d !== 'object' || d === null || !Array.isArray(d.cards)) {
      droppedDecks += 1;
      continue;
    }
    const cards: CompactCard[] = [];
    for (const rawCard of d.cards) {
      const c = rawCard as Partial<CompactCard> | null;
      if (
        typeof c !== 'object' ||
        c === null ||
        typeof c.q !== 'string' ||
        c.q.trim().length === 0
      ) {
        droppedCards += 1;
        continue;
      }
      const card: CompactCard = {
        q: c.q,
        a: typeof c.a === 'string' ? c.a : '',
      };
      if (Array.isArray(c.tags)) {
        card.tags = c.tags.filter((t): t is string => typeof t === 'string');
      }
      if (typeof c.cloze === 'boolean') {
        card.cloze = c.cloze;
      }
      if (Array.isArray(c.media)) {
        card.media = c.media.filter((m): m is string => typeof m === 'string');
      }
      cards.push(card);
    }
    decks.push({
      deck:
        typeof d.deck === 'string' && d.deck.trim().length > 0
          ? d.deck
          : 'Untitled deck',
      cards,
    });
  }

  if (droppedDecks > 0 || droppedCards > 0) {
    console.warn('[Claude] Dropped malformed entries from parsed response', {
      chunkIndex,
      droppedDecks,
      droppedCards,
    });
  }
  return decks;
}

export function parseDeckResponse(
  cleaned: string,
  raw: string,
  chunkIndex: number
): CompactDeck[] {
  const toParse = extractJsonArray(cleaned) ?? cleaned;

  const jsonEnd = toParse.lastIndexOf(']');
  if (jsonEnd >= 0) {
    const trailing = cleaned.slice(cleaned.lastIndexOf(']') + 1).trim();
    if (trailing.length > 0) {
      console.warn('[Claude] Trailing prose stripped', {
        chunkIndex,
        strippedBytes: trailing.length,
        sample: trailing.slice(0, 80),
      });
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(toParse);
  } catch {
    const repaired = tryRepairDeckArray(toParse);
    if (repaired) {
      parsed = repaired;
      console.log('[Claude] Recovered malformed JSON via jsonrepair', {
        chunkIndex,
      });
    } else {
      console.error('[Claude] Failed to parse response as JSON', {
        chunkIndex,
        repairFailureReason: describeRepairFailure(toParse),
        rawTail: raw.slice(-400),
        raw: redactClaudePayload(raw),
        cleaned: redactClaudePayload(cleaned),
        toParse: redactClaudePayload(toParse),
      });
      // raw passed as its own string argument: util.inspect truncates strings
      // nested in objects at 10k chars, which silently dropped most of the dump.
      console.error(
        '[Claude] Unrecoverable parse failure — full response',
        { chunkIndex },
        raw
      );
      if (looksLikeEmptyContentExplanation(cleaned)) {
        throw new Error(EMPTY_CONTENT_USER_MESSAGE);
      }
      throw new ClaudeLargeSectionError();
    }
  }

  if (!Array.isArray(parsed)) {
    console.error('[Claude] Response is not an array', {
      chunkIndex,
      raw: redactClaudePayload(raw),
      cleaned: redactClaudePayload(cleaned),
    });
    throw new ClaudeParseError();
  }

  return sanitizeCompactDecks(parsed, chunkIndex);
}

async function generateDeckInfoFromChunk(
  strippedContent: string,
  pageStyle: string,
  availableMediaFiles: string[],
  userInstructions: string | undefined,
  chunkIndex: number,
  totalChunks: number,
  onProgress?: (step: string) => void,
  cardStyle?: string,
  cardSize?: string,
  fieldMapping?: FieldMapping,
  usageCollector?: (usage: ChunkUsage) => void
): Promise<DeckInfo[]> {
  const tChunk0 = Date.now();
  const client = getAnthropicClient();

  const cardStyleFragment = getCardStylePromptFragment(cardStyle);
  const userMessage = buildUserMessage(
    strippedContent,
    availableMediaFiles,
    userInstructions,
    cardStyleFragment,
    cardSize,
    fieldMapping
  );

  onProgress?.(`claude:chunk:${chunkIndex + 1}:${totalChunks}`);

  console.log('[Claude] Sending request to Claude API', {
    model: 'claude-sonnet-5',
    promptBytes: userMessage.length,
    maxTokens: CHUNK_MAX_TOKENS,
    mediaFilesCount: availableMediaFiles.length,
    hasUserInstructions: !!userInstructions?.trim(),
    chunkIndex,
    totalChunks,
  });

  const tApi0 = Date.now();
  const runStream = async (): Promise<Message> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = (client.messages as any).stream({
      model: 'claude-sonnet-5',
      max_tokens: CHUNK_MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    });

    let lastPulseMs = Date.now();
    stream.on('text', () => {
      const now = Date.now();
      if (now - lastPulseMs >= 5000) {
        onProgress?.(`claude:chunk:${chunkIndex + 1}:${totalChunks}`);
        lastPulseMs = now;
      }
    });

    return (await stream.finalMessage()) as Message;
  };

  let response: Message;
  for (let attempt = 1; ; attempt++) {
    try {
      response = await runStream();
      break;
    } catch (err) {
      const elapsedMs = Date.now() - tApi0;
      const error = err instanceof Error ? err : new Error(String(err));
      const cause = 'cause' in error ? error.cause : undefined;
      const rootCause =
        cause instanceof Error && 'cause' in cause ? cause.cause : undefined;
      const willRetry =
        attempt < MAX_CHUNK_API_ATTEMPTS && isTransientChunkError(err);
      console.error('[Claude] API request failed', {
        elapsedMs,
        chunkIndex,
        totalChunks,
        attempt,
        willRetry,
        error: error.message,
        cause: causeMessage(cause),
        causeCode: causeCode(cause),
        rootCause: causeMessage(rootCause),
        rootCauseCode: causeCode(rootCause),
      });
      if (!willRetry) {
        throw error;
      }
      await sleepMs(CHUNK_RETRY_BASE_DELAY_MS * attempt);
      onProgress?.(`claude:chunk:${chunkIndex + 1}:${totalChunks}`);
    }
  }
  const apiMs = Date.now() - tApi0;

  console.log('[Claude] Received response', {
    stopReason: response.stop_reason,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    cacheCreationTokens: response.usage?.cache_creation_input_tokens,
    cacheReadTokens: response.usage?.cache_read_input_tokens,
    apiDurationMs: apiMs,
    tokensPerSecond: response.usage?.output_tokens
      ? Math.round((response.usage.output_tokens / apiMs) * 1000)
      : null,
    chunkIndex,
    totalChunks,
  });
  recordClaudeUsage({
    surface: 'conversion',
    model: response.model,
    usage: response.usage,
    durationMs: apiMs,
  });
  if (usageCollector && response.usage) {
    usageCollector({
      input_tokens: response.usage.input_tokens ?? 0,
      output_tokens: response.usage.output_tokens ?? 0,
      cache_creation_input_tokens:
        response.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    });
  }

  if (response.stop_reason === 'max_tokens') {
    console.warn('[Claude] Response truncated at max_tokens', {
      chunkIndex,
      totalChunks,
      maxTokens: CHUNK_MAX_TOKENS,
      chunkBytes: strippedContent.length,
    });
    throw new ClaudeTruncatedError(strippedContent);
  }

  const raw = (response.content as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');

  const cleaned = raw.replace(/^```json\n?|^```\n?|```\s*$/gm, '').trim();

  const tParse0 = Date.now();
  const parsed = parseDeckResponse(cleaned, raw, chunkIndex);

  const deckInfo = expandCompactDeckInfo(
    parsed,
    availableMediaFiles,
    pageStyle || null
  );
  const parseMs = Date.now() - tParse0;
  console.log('[Claude] chunk done', {
    chunkIndex,
    totalChunks,
    decksCount: deckInfo.length,
    totalCards: deckInfo.reduce((sum, deck) => sum + deck.cards.length, 0),
    apiMs,
    parseMs,
    chunkTotalMs: Date.now() - tChunk0,
  });
  return deckInfo;
}

const FLOOR_V1_BOUNDS_BY_CARD_SIZE = {
  short: { floor: 200, ceiling: 500 },
  medium: { floor: 150, ceiling: 400 },
  detailed: { floor: 80, ceiling: 250 },
} as const;

export function resolveFloorV1Bounds(cardSize: string | undefined): {
  floor: number;
  ceiling: number;
} {
  return FLOOR_V1_BOUNDS_BY_CARD_SIZE[validateCardSize(cardSize)];
}

const FLOOR_V1_MAX_TOPUP_ROUNDS = 2;
const FLOOR_V1_MAX_PARALLEL = 4;
const FLOOR_V1_TOPUP_BUDGET_MS = 50_000;

export interface PdfImageFallbackContext {
  mediaBaseDir: string;
  attachPageImages?: boolean;
}

export interface GenerateDeckInfoOptions {
  isPaying?: boolean;
  userId?: number | null;
  comprehensive?: boolean;
  pdfImageFallback?: PdfImageFallbackContext;
}

interface ChunkUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

function computeCostUsd(usages: ChunkUsage[]): number {
  const cost = usages.reduce((sum, u) => sum + computeUsageCostUsd(null, u), 0);
  return Math.round(cost * 10_000) / 10_000;
}

async function runWithSemaphore<T>(
  thunks: Array<() => Promise<T>>,
  concurrency: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(thunks.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const workerCount = Math.min(concurrency, thunks.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= thunks.length) return;
          try {
            results[idx] = { status: 'fulfilled', value: await thunks[idx]() };
          } catch (err) {
            results[idx] = { status: 'rejected', reason: err };
          }
        }
      })()
    );
  }
  await Promise.all(workers);
  return results;
}

function totalCardCount(decks: DeckInfo[]): number {
  return decks.reduce((sum, d) => sum + d.cards.length, 0);
}

function cardCountByChunk(decks: DeckInfo[], chunkCount: number): number[] {
  const counts = new Array(chunkCount).fill(0);
  for (const deck of decks) {
    for (const card of deck.cards) {
      if (card.chunkIndex != null && card.chunkIndex < chunkCount) {
        counts[card.chunkIndex] += 1;
      }
    }
  }
  return counts;
}

function thinnestQuartileIndices(perChunkCounts: number[]): number[] {
  const indexed = perChunkCounts.map((count, index) => ({ count, index }));
  indexed.sort((a, b) => a.count - b.count);
  const quartileSize = Math.max(1, Math.ceil(indexed.length / 4));
  return indexed.slice(0, quartileSize).map((entry) => entry.index);
}

export function collectExistingFronts(decks: DeckInfo[]): string[] {
  const fronts: string[] = [];
  for (const deck of decks) {
    for (const card of deck.cards) {
      fronts.push(card.name);
    }
  }
  return fronts;
}

const TOP_UP_FRONT_SAMPLE_SIZE = 80;

// Spread the sample across the whole accumulated list instead of taking the
// first N. With a cross-file accumulator that grows in file order, slice(0, N)
// froze the hint to the earliest file once it alone produced N fronts, so later
// files' prompts never saw the files just before them. An even stride keeps
// every earlier file represented.
export function sampleEvenly<T>(items: T[], cap: number): T[] {
  if (items.length <= cap) return items;
  const sampled: T[] = [];
  for (let i = 0; i < cap; i++) {
    sampled.push(items[Math.floor((i * items.length) / cap)]);
  }
  return sampled;
}

export function buildTopUpInstruction(
  existingFronts: string[],
  cardSize: string | undefined
): string {
  const sample = sampleEvenly(existingFronts, TOP_UP_FRONT_SAMPLE_SIZE).map(
    (f) => (f ?? '').replace(/<[^>]*>/g, '').slice(0, 120)
  );
  const list = sample.map((s) => `- ${s}`).join('\n');
  const lead =
    validateCardSize(cardSize) === 'detailed'
      ? 'Extract MORE cards from the same content, keeping 3-4 related facts per card.'
      : 'Extract MORE single-fact cards from the same content.';
  return `${lead} Do NOT repeat any of these fronts:\n${list}\n\nReturn only net-new cards.`;
}

export interface CrossFileDedupState {
  fronts: string[];
  seenKeys: Set<string>;
  filesProcessed: number;
  suppressed: number;
}

export function createCrossFileDedupState(): CrossFileDedupState {
  return { fronts: [], seenKeys: new Set(), filesProcessed: 0, suppressed: 0 };
}

// Suppress only cards that matched an EARLIER file. Filtering against
// state.seenKeys (frozen to prior files) rather than a set that grows within
// this file preserves single-file semantics: dedupeIdenticalCards scopes
// per-deck, so a card legitimately repeated across two sub-decks of the same
// file survives, and cross_file_duplicates_suppressed counts only genuine
// cross-file drops. This file's own keys are absorbed after filtering, so the
// next file dedupes against them.
export function absorbFileIntoCrossFileDedup(
  state: CrossFileDedupState,
  decks: DeckInfo[]
): DeckInfo[] {
  const priorKeys = state.seenKeys;
  const thisFileKeys = new Set<string>();
  const deduped = decks.map((deck) => {
    const cards = deck.cards.filter((card) => {
      const key = cardDedupeKey(card);
      if (priorKeys.has(key)) {
        state.suppressed += 1;
        return false;
      }
      thisFileKeys.add(key);
      return true;
    });
    return { ...deck, cards };
  });
  for (const key of thisFileKeys) state.seenKeys.add(key);
  state.fronts.push(...collectExistingFronts(deduped));
  state.filesProcessed += 1;
  return deduped;
}

function stampChunkIndex(decks: DeckInfo[], chunkIndex: number): DeckInfo[] {
  for (const deck of decks) {
    for (const card of deck.cards) {
      card.chunkIndex = chunkIndex;
    }
  }
  return decks;
}

async function runChunkWithTruncationRetry(
  content: string,
  call: (content: string) => Promise<DeckInfo[]>
): Promise<DeckInfo[]> {
  try {
    return await call(content);
  } catch (err) {
    if (!(err instanceof ClaudeTruncatedError)) throw err;
    const halves = splitChunkInHalf(content);
    if (halves.length < 2) throw err;
    console.info('[Claude] Retrying truncated chunk as halves', {
      originalBytes: content.length,
      halfBytes: halves.map((h) => h.length),
    });
    const settled = await Promise.allSettled(halves.map((half) => call(half)));
    const parsed = settled
      .filter(
        (r): r is PromiseFulfilledResult<DeckInfo[]> => r.status === 'fulfilled'
      )
      .map((r) => r.value);
    // Under Promise.all a second truncation on one half discarded the cards the
    // other half had already produced, and the caller saw the chunk as a total
    // loss — 53 cards shipped where 129 were parsed. Half a chunk beats none.
    if (parsed.length === 0) throw err;
    if (parsed.length < halves.length) {
      console.info('[Claude] Keeping the halves that parsed', {
        ok: parsed.length,
        total: halves.length,
      });
    }
    return parsed.flat();
  }
}

async function runChunks(
  thunks: Array<() => Promise<DeckInfo[]>>
): Promise<DeckInfo[]> {
  const settled = await Promise.allSettled(thunks.map((fn) => fn()));
  const succeeded: DeckInfo[][] = [];
  const failures: Array<{ chunkIndex: number; reason: string }> = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      succeeded.push(r.value);
    } else {
      failures.push({
        chunkIndex: i,
        reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  if (failures.length > 0) {
    console.info('[Claude] Some chunks failed; continuing with the rest', {
      failures,
      ok: succeeded.length,
      total: thunks.length,
    });
  }

  if (succeeded.length === 0) {
    throw new Error(failures[0]?.reason ?? 'All Claude chunks failed');
  }

  return succeeded.flat();
}

export async function generateDeckInfo(
  htmlContent: string,
  availableMediaFiles: string[],
  userInstructions?: string,
  onProgress?: (step: string) => void,
  cardStyle?: string,
  cardSize?: string,
  fieldMapping?: FieldMapping,
  options?: GenerateDeckInfoOptions
): Promise<DeckInfo[]> {
  const t0 = Date.now();

  if (options?.pdfImageFallback) {
    // The per-page vision path intentionally bypasses comprehensive, cardStyle,
    // cardSize, and fieldMapping — carrying them here is deferred to a tracking issue.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {
      generateDeckInfoFromPdfImages,
    } = require('./generateDeckInfoFromPdfImages');
    return generateDeckInfoFromPdfImages(
      htmlContent,
      options.pdfImageFallback,
      userInstructions,
      onProgress
    );
  }

  if (isImageOnlyContent(htmlContent)) {
    console.info('[Claude] Skipping conversion: image-only input', {
      originalBytes: htmlContent.length,
    });
    throw new ImageOnlyContentError();
  }

  const tStrip0 = Date.now();
  const pageStyle = extractStyleFromHtml(htmlContent);
  const strippedContent = stripHtmlBoilerplate(htmlContent);
  console.log('[Claude] stripHtmlBoilerplate', {
    originalBytes: htmlContent.length,
    strippedBytes: strippedContent.length,
    savedBytes: htmlContent.length - strippedContent.length,
    savedPct:
      htmlContent.length > 0
        ? (
            ((htmlContent.length - strippedContent.length) /
              htmlContent.length) *
            100
          ).toFixed(1) + '%'
        : 'N/A',
    durationMs: Date.now() - tStrip0,
  });

  const floorV1Active =
    options?.comprehensive === true && options?.isPaying === true;

  if (cardStyle === 'heading-driven') {
    const headings = detect('html', strippedContent);
    if (headings.length > 0) {
      const chunks = splitByHeadings(headings);
      console.log('[Claude] heading-driven chunks', {
        headingCount: headings.length,
        chunkCount: chunks.length,
      });
      const chunkResults = await runChunks(
        chunks.map(
          (chunk, i) => () =>
            runChunkWithTruncationRetry(
              `<h1>${chunk.anchor}</h1>\n${chunk.bodyChunk}`,
              (content) =>
                generateDeckInfoFromChunk(
                  content,
                  pageStyle,
                  availableMediaFiles,
                  userInstructions,
                  i,
                  chunks.length,
                  onProgress,
                  cardStyle,
                  cardSize,
                  fieldMapping
                )
            )
        )
      );
      const deckInfo = mergeDeckInfoArrays(chunkResults);
      console.log('[Claude] All heading-driven chunks done', {
        totalDecks: deckInfo.length,
        totalCards: deckInfo.reduce((sum, d) => sum + d.cards.length, 0),
        totalMs: Date.now() - t0,
      });
      return deckInfo;
    }
    console.log('[Claude] heading-driven:fallback', {
      reason: 'no headings detected',
      strippedBytes: strippedContent.length,
    });
  }

  const chunks = chunkHtmlByDetails(strippedContent);
  console.log('[Claude] Chunked HTML', {
    chunks: chunks.length,
    strippedBytes: strippedContent.length,
  });

  if (floorV1Active) {
    const result = await runFloorV1(
      chunks,
      pageStyle,
      availableMediaFiles,
      userInstructions,
      onProgress,
      cardStyle,
      cardSize,
      fieldMapping
    );
    const deckInfo = result.deckInfo;
    const elapsedMs = Date.now() - t0;
    const cardCount = totalCardCount(deckInfo);
    const costUsd = computeCostUsd(result.usages);
    console.log('[Claude] All chunks done (floor v1)', {
      totalDecks: deckInfo.length,
      totalCards: cardCount,
      topUpRounds: result.topUpRounds,
      costUsd,
      totalMs: elapsedMs,
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { track } = require('../../services/events/track');
    track('ai_conversion_completed', {
      userId: options?.userId ?? null,
      props: {
        card_count: cardCount,
        chunks: chunks.length,
        top_up_rounds: result.topUpRounds,
        cost_usd: costUsd,
        elapsed_ms: elapsedMs,
        comprehensive: true,
        ...(result.clampedFrom != null
          ? { clamped_from: result.clampedFrom }
          : {}),
      },
    });
    return deckInfo;
  }

  const chunkResults = await runChunks(
    chunks.map(
      (chunk, i) => () =>
        runChunkWithTruncationRetry(chunk, (content) =>
          generateDeckInfoFromChunk(
            content,
            pageStyle,
            availableMediaFiles,
            userInstructions,
            i,
            chunks.length,
            onProgress,
            cardStyle,
            cardSize,
            fieldMapping
          )
        )
    )
  );

  const deckInfo = mergeDeckInfoArrays(chunkResults);
  console.log('[Claude] All chunks done', {
    totalDecks: deckInfo.length,
    totalCards: deckInfo.reduce((sum, d) => sum + d.cards.length, 0),
    totalMs: Date.now() - t0,
  });

  return deckInfo;
}

interface FloorV1Result {
  deckInfo: DeckInfo[];
  usages: ChunkUsage[];
  topUpRounds: number;
  clampedFrom?: number;
}

async function runFloorV1(
  chunks: string[],
  pageStyle: string,
  availableMediaFiles: string[],
  userInstructions: string | undefined,
  onProgress: ((step: string) => void) | undefined,
  cardStyle: string | undefined,
  cardSize: string | undefined,
  fieldMapping: FieldMapping | undefined
): Promise<FloorV1Result> {
  const tStart = Date.now();
  const usages: ChunkUsage[] = [];
  const collect = (usage: ChunkUsage) => usages.push(usage);
  const bounds = resolveFloorV1Bounds(cardSize);

  const firstRoundResults = await runWithSemaphore(
    chunks.map(
      (chunk, i) => () =>
        runChunkWithTruncationRetry(chunk, (content) =>
          generateDeckInfoFromChunk(
            content,
            pageStyle,
            availableMediaFiles,
            userInstructions,
            i,
            chunks.length,
            onProgress,
            cardStyle,
            cardSize,
            fieldMapping,
            collect
          )
        ).then((decks) => stampChunkIndex(decks, i))
    ),
    FLOOR_V1_MAX_PARALLEL
  );

  const initialDecks: DeckInfo[] = [];
  firstRoundResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      initialDecks.push(...r.value);
    } else {
      console.warn('[Claude] floor v1 chunk failed', {
        chunkIndex: i,
        reason: String(r.reason),
      });
    }
  });

  let merged = mergeDeckInfoArrays(initialDecks);
  let topUpRounds = 0;

  while (
    topUpRounds < FLOOR_V1_MAX_TOPUP_ROUNDS &&
    totalCardCount(merged) < bounds.floor &&
    Date.now() - tStart < FLOOR_V1_TOPUP_BUDGET_MS
  ) {
    const beforeCount = totalCardCount(merged);
    const perChunkCounts = cardCountByChunk(merged, chunks.length);
    const targetChunks = thinnestQuartileIndices(perChunkCounts);
    const existingFronts = collectExistingFronts(merged);
    const topUpInstruction = buildTopUpInstruction(existingFronts, cardSize);
    const combinedInstructions = userInstructions
      ? `${userInstructions}\n\n${topUpInstruction}`
      : topUpInstruction;

    const topUpResults = await runWithSemaphore(
      targetChunks.map(
        (idx) => () =>
          runChunkWithTruncationRetry(chunks[idx], (content) =>
            generateDeckInfoFromChunk(
              content,
              pageStyle,
              availableMediaFiles,
              combinedInstructions,
              idx,
              chunks.length,
              onProgress,
              cardStyle,
              cardSize,
              fieldMapping,
              collect
            )
          ).then((decks) => stampChunkIndex(decks, idx))
      ),
      FLOOR_V1_MAX_PARALLEL
    );

    const newDecks: DeckInfo[] = [];
    topUpResults.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        newDecks.push(...r.value);
      } else {
        console.warn('[Claude] floor v1 top-up chunk failed', {
          chunkIndex: targetChunks[i],
          reason: String(r.reason),
          round: topUpRounds + 1,
        });
      }
    });

    merged = mergeDeckInfoArrays([...initialDecks, ...newDecks]);
    initialDecks.push(...newDecks);
    topUpRounds += 1;

    if (totalCardCount(merged) <= beforeCount) {
      console.log('[Claude] floor v1 top-up stopped: zero net-new cards', {
        round: topUpRounds,
      });
      break;
    }
  }

  let clampedFrom: number | undefined;
  const preClampCount = totalCardCount(merged);
  if (preClampCount > bounds.ceiling) {
    console.log('[Claude] floor v1 ceiling clamp', {
      preClampCount,
      ceiling: bounds.ceiling,
    });
    merged = clampDeckTotal(merged, bounds.ceiling);
    clampedFrom = preClampCount;
  }

  return { deckInfo: merged, usages, topUpRounds, clampedFrom };
}

function clampDeckTotal(decks: DeckInfo[], ceiling: number): DeckInfo[] {
  const clamped: DeckInfo[] = [];
  let remaining = ceiling;
  for (const deck of decks) {
    if (remaining <= 0) {
      clamped.push({ ...deck, cards: [] });
      continue;
    }
    if (deck.cards.length <= remaining) {
      clamped.push(deck);
      remaining -= deck.cards.length;
    } else {
      clamped.push({ ...deck, cards: deck.cards.slice(0, remaining) });
      remaining = 0;
    }
  }
  return clamped;
}

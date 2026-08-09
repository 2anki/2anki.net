import fs from 'node:fs';
import path from 'node:path';
import os, { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

import {
  extractJsonArray,
  getAnthropicClient,
  normalizeTag,
} from '../../lib/claude/ClaudeService';
import { ANKI_MATH_FRAGMENT } from '../../lib/claude/ankiMathFragment';
import {
  countVisionTokens,
  VISION_TOKEN_CEILING,
  VisionMediaType,
} from '../../lib/claude/countVisionTokens';
import {
  CREATE_DECK_DIR,
  CREATE_DECK_SCRIPT_PATH,
  TEMPLATE_DIR,
} from '../../lib/constants';
import { track } from '../../services/events/track';
import type { IEventsRepository } from '../../data_layer/EventsRepository';
import {
  asValidMcq,
  classifyVerbatimShape,
  looksLikeMcqAttempt,
  type VerbatimCard,
} from '../../lib/vision/classifyVerbatimShape';

const MCQ_PROMPT_RULES = `- If the page shows a multiple-choice question with four options and a single correct answer, use: {"q":"question stem","options":["A","B","C","D"],"correct_index":0,"rationale":"why the correct option is right (optional)"}
- correct_index is the 0-based position of the right option; the options array must have exactly four entries
- If the source is not multiple choice, use the plain {"q":"...","a":"..."} shape instead`;

export const FREE_PHOTO_QUOTA_PER_MONTH = 5;
const VISION_PHOTO_EVENT = 'vision_photo_converted';

export type PhotoDensity = 'sparse' | 'balanced' | 'dense';
export type PhotoMode = 'generative' | 'verbatim';
export type PhotoCardStyle = 'generative' | 'heading-driven';

export const DEFAULT_PHOTO_DENSITY: PhotoDensity = 'balanced';
export const DEFAULT_PHOTO_MODE: PhotoMode = 'generative';
export const DEFAULT_PHOTO_CARD_STYLE: PhotoCardStyle = 'generative';

export interface PhotoToFlashcardsInput {
  imageBase64: string;
  mediaType: VisionMediaType;
  deckName: string;
  owner: string;
  isPaying: boolean;
  imageDimensions: { width: number; height: number };
  tokenCeilingOverride?: number;
  includeSourceImage?: boolean;
  density?: PhotoDensity;
  mode?: PhotoMode;
  cardStyle?: PhotoCardStyle;
  mcqEnabled?: boolean;
}

export interface PhotoToFlashcardsResult {
  apkgPath: string;
  cardCount: number;
  estimatedCostUsd: number;
  tileCount: number;
  mcqCount: number;
  mcqSkippedCount: number;
}

export interface GeneratedFlashcard {
  front: string;
  back: string;
}

export interface PhotoVisionCards {
  decks: CompactDeck[];
  cards: GeneratedFlashcard[];
  cardCount: number;
  deckName: string;
  estimatedCostUsd: number;
  tileCount: number;
  inputTokens: number;
  outputTokens: number;
}

function ownerToUserId(owner: string): number | null {
  const n = Number(owner);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function startOfMonth(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

const DENSITY_RULE: Record<PhotoDensity, string> = {
  sparse: 'Aim for 3 to 5 cards. Pick the highest-signal facts only.',
  balanced: 'Aim for 6 to 10 cards covering the main facts.',
  dense: 'Aim for 12 to 20 cards. Fan out every distinct fact on the image.',
};

export function buildVisionPrompt(
  density: PhotoDensity = DEFAULT_PHOTO_DENSITY,
  options: { mcqEnabled?: boolean } = {}
): string {
  const mcqLines = options.mcqEnabled ? `\n${MCQ_PROMPT_RULES}` : '';
  return `Extract atomic question-and-answer flashcard pairs from this image.

Output ONLY a compact JSON array. Format (nothing else — no markdown, no explanation):
[{"deck":"Deck Name","cards":[{"q":"front text","a":"back text","tags":["topic_tag"]}]}]

Rules:
- Each card tests one atomic fact
- Q is the question or term, A is the answer or definition
- Preserve important formatting but keep cards concise
- ${DENSITY_RULE[density]}
- Use the image content as the deck name if no other name is obvious
- Add 1–3 topic tags per card in the "tags" field: short, lowercase, snake_case, drawn from the actual content (e.g. "enzymes", "michaelis_menten") — not broad labels like "biology" or "chapter_4"${mcqLines}

${ANKI_MATH_FRAGMENT}`;
}

export function buildVerbatimPrompt(): string {
  return `Transcribe the questions and answers on this page exactly as written. Do not paraphrase. Do not invent questions. Do not add distractors. Do not expand abbreviations. If text is illegible, output the token [illegible] in place of that character or word. Preserve original ordering.

Output ONLY a compact JSON array. Format (nothing else — no markdown, no explanation):
[{"deck":"Deck Name","cards":[{"q":"question text","a":"answer text"}]}]

Rules:
- Copy each question and answer verbatim from the page — no rewording
- If the page shows MCQ options and a correct answer, use: {"q":"question text","options":["A","B","C","D"],"correct_index":0}
- If no correct answer is visible for an MCQ, omit "correct_index"
- If text is illegible, write [illegible] in its place
- Use the page title or subject as the deck name if visible; otherwise use "Verbatim deck"
- Do not add tags
- Preserve hierarchy: if the source has nested bullets, indented items, or nesting markers (→, >, -, •, *), emit the answer as nested HTML lists using <ul><li>…<ul><li>…</li></ul></li></ul>. Sibling items at the same level are separate <li> elements. Do not flatten a multi-level structure into a single line with > separators. If the source has no visible hierarchy (a single line or a flat list with no nesting), emit plain text — do not introduce spurious structure.

${ANKI_MATH_FRAGMENT}`;
}

export function buildHeadingDrivenVisionPrompt(): string {
  return `Extract flashcard pairs from this image, grouping by slide title or section heading.

Output ONLY a compact JSON array. Format (nothing else — no markdown, no explanation):
[{"deck":"Deck Name","cards":[{"q":"front text","a":"back text","tags":["topic_tag"]}]}]

Rules:
- Detect slide titles, section headings, or chapter titles visible on the image
- For each heading, produce 2–6 cards covering the key facts under that heading
- Each card tests one atomic fact
- Q is the question or term, A is the answer or definition
- Use the detected heading as a tag on each card so slides stay traceable (short, lowercase, snake_case)
- Add 1–3 content tags per card in addition to the heading tag
- Use the overall topic as the deck name
- If no distinct headings are visible, treat the full image as one section`;
}

function resolvePrompt(
  mode: PhotoMode,
  cardStyle: PhotoCardStyle,
  density: PhotoDensity,
  mcqEnabled: boolean
): string {
  if (mode === 'verbatim') return buildVerbatimPrompt();
  if (cardStyle === 'heading-driven') return buildHeadingDrivenVisionPrompt();
  return buildVisionPrompt(density, { mcqEnabled });
}

const INPUT_COST_PER_MILLION = 3;
const OUTPUT_COST_PER_MILLION = 15;
const VISION_MAX_TOKENS = 8192;
const VISION_RETRY_MAX_TOKENS = 16384;

function findPython(): string {
  const envOverride = process.env.PYTHON ?? process.env.ANKI_PYTHON;
  if (envOverride) return envOverride;

  const venvPython = path.join(CREATE_DECK_DIR, 'venv', 'bin', 'python3');
  if (fs.existsSync(venvPython)) return venvPython;

  if (process.platform === 'win32') {
    const localPython = path.join(
      homedir(),
      'AppData',
      'Local',
      'Programs',
      'Python',
      'Python38',
      'python.exe'
    );
    if (fs.existsSync(localPython)) return localPython;
    for (const cmd of ['py', 'python', 'python3']) {
      try {
        execFileSync(cmd, ['--version'], { stdio: 'ignore' });
        return cmd;
      } catch {
        continue;
      }
    }
  }

  for (const p of [
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
  ]) {
    if (fs.existsSync(p)) return p;
  }

  return 'python3';
}

function runDeckBridge(workspaceDir: string): Promise<string> {
  const python = findPython();
  const deckInfoPath = path.join(workspaceDir, 'deck_info.json');
  return new Promise((resolve, reject) => {
    const proc = spawn(
      python,
      [CREATE_DECK_SCRIPT_PATH, deckInfoPath, TEMPLATE_DIR + path.sep],
      { cwd: workspaceDir }
    );
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    proc.stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString()));
    proc.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        const stderr = stderrChunks.join('');
        return reject(
          new Error(`Deck builder exited with code ${code}: ${stderr}`)
        );
      }
      const output = stdoutChunks.join('').trim();
      const lastLine = output.split('\n').pop() ?? '';
      if (!lastLine.endsWith('.apkg')) {
        return reject(
          new Error(
            `Deck builder did not return a valid .apkg path. stdout: ${output || '(empty)'}`
          )
        );
      }
      resolve(lastLine);
    });
  });
}

function makeForbiddenError(): Error & { status: number } {
  const err = new Error('Ankify access required') as Error & { status: number };
  err.status = 403;
  return err;
}

function makePayloadTooLargeError(): Error & { status: number } {
  const err = new Error(
    'Photo is too large — try a smaller or lower-resolution image'
  ) as Error & { status: number };
  err.status = 413;
  return err;
}

function makeUnreadableVisionResponseError(): Error & { status: number } {
  const err = new Error(
    "Couldn't read the cards from this photo. Try a clearer or less dense image."
  ) as Error & { status: number };
  err.status = 422;
  return err;
}

function makeFreeQuotaReachedError(
  used: number,
  limit: number
): Error & {
  status: number;
  used: number;
  limit: number;
} {
  const err = new Error(
    `Free plan is ${limit} photos per month. You've used ${used}. Upgrade for unlimited.`
  ) as Error & { status: number; used: number; limit: number };
  err.status = 429;
  err.used = used;
  err.limit = limit;
  return err;
}

type CompactCard = VerbatimCard;

interface CompactDeck {
  deck: string;
  cards: CompactCard[];
}

// VerbatimCard types q and a as strings, but the vision response is blind-cast
// from Claude's JSON and the verbatim MCQ shape carries neither an answer nor a
// rationale. Interpolating the missing field put the word "undefined" on the
// back of the card instead of leaving it empty.
function answerText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function cardBack(card: CompactCard): string {
  return answerText(card.a) || answerText(card.rationale);
}

function flattenDecksToCards(decks: CompactDeck[]): GeneratedFlashcard[] {
  return decks.flatMap((deck) =>
    deck.cards.map((card) => ({ front: card.q ?? '', back: cardBack(card) }))
  );
}

function logUnreadableVisionResponse(raw: string): void {
  console.log(
    JSON.stringify({
      event: 'vision_parse_failed',
      source: 'photo',
      response_length: raw.length,
      response_sha256_prefix: createHash('sha256')
        .update(raw)
        .digest('hex')
        .slice(0, 12),
      response_prefix: raw.slice(0, 200),
      response_tail: raw.slice(-200),
    })
  );
}

// The model's own field set is wider than the shared parser's: an MCQ card
// carries options, correct_index, and rationale, which sanitizeCompactDecks
// drops. Cards keep their shape here; only entries that would crash the caller
// are removed — a deck with no cards array, or a card with no usable front.
function sanitizeVisionDecks(parsed: unknown[]): CompactDeck[] {
  const decks: CompactDeck[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = entry as { deck?: unknown; cards?: unknown };
    if (!Array.isArray(raw.cards)) continue;
    const cards = raw.cards.filter((card) => {
      if (typeof card !== 'object' || card === null) return false;
      const q = (card as { q?: unknown }).q;
      return typeof q === 'string' && q.trim().length > 0;
    });
    decks.push({
      deck:
        typeof raw.deck === 'string' && raw.deck.trim().length > 0
          ? raw.deck
          : 'Photo deck',
      // The card shape is whatever the model emitted; buildDeckCards reads every
      // field defensively, which is why a cast is enough here.
      cards: cards as CompactCard[],
    });
  }
  return decks;
}

function parseClaudeVisionResponse(raw: string): CompactDeck[] {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  // Slicing from index 0 made a single sentence of preamble fatal on this path
  // while the shared parser shrugs it off. Prod carries vision_parse_failed on
  // complete responses for exactly that reason.
  const toParse = extractJsonArray(cleaned) ?? cleaned;

  let parsed: unknown;
  try {
    parsed = JSON.parse(toParse);
  } catch {
    logUnreadableVisionResponse(raw);
    throw makeUnreadableVisionResponseError();
  }

  if (!Array.isArray(parsed)) {
    logUnreadableVisionResponse(raw);
    throw makeUnreadableVisionResponseError();
  }

  // An array of bare cards parses fine and then crashes the caller on
  // d.cards.length, which surfaces as a 400 carrying the internal message.
  const decks = sanitizeVisionDecks(parsed);
  if (decks.length === 0) {
    logUnreadableVisionResponse(raw);
    throw makeUnreadableVisionResponseError();
  }
  return decks;
}

function mediaTypeToExt(mediaType: VisionMediaType): string {
  const extMap: Record<VisionMediaType, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return extMap[mediaType];
}

interface BuildDeckInfoResult {
  deckInfo: Record<string, unknown>;
  mcqCount: number;
  mcqSkippedCount: number;
}

interface CardBaseFields {
  tags: string[];
  number: number;
  enableInput: boolean;
  answer: string;
  media: string[];
}

function buildBaseFields(
  card: CompactCard,
  index: number,
  sourceFilename: string | null
): CardBaseFields {
  return {
    tags: (card.tags ?? []).map(normalizeTag).filter((t) => t.length > 0),
    number: index,
    enableInput: false,
    answer: '',
    media: sourceFilename == null ? [] : [sourceFilename],
  };
}

function buildMcqCard(
  card: CompactCard,
  base: CardBaseFields,
  sourceImageTag: string
) {
  const validMcq = asValidMcq(card);
  if (validMcq == null) return null;
  const rationaleBack =
    validMcq.rationale.length > 0 ? validMcq.rationale : answerText(card.a);
  return {
    ...base,
    name: card.q,
    back: `${rationaleBack}${sourceImageTag}`,
    cloze: false,
    mcq: true,
    options: validMcq.options,
    correctIndices: [validMcq.correctIndex],
  };
}

function buildBasicCard(
  card: CompactCard,
  base: CardBaseFields,
  sourceImageTag: string,
  cloze: boolean
) {
  return {
    ...base,
    name: card.q,
    back: `${answerText(card.a)}${sourceImageTag}`,
    cloze,
  };
}

function sourceImageTagFor(sourceFilename: string | null): string {
  return sourceFilename == null
    ? ''
    : `<br><img src="${sourceFilename}" style="max-width:100%;height:auto;">`;
}

function buildDeckCards(
  decks: CompactDeck[],
  sourceFilename: string | null,
  mode: PhotoMode,
  mcqEnabled: boolean
): {
  cards: Record<string, unknown>[];
  mcqCount: number;
  mcqSkippedCount: number;
} {
  let mcqCount = 0;
  let mcqSkippedCount = 0;

  const cards = decks.flatMap((d) =>
    d.cards.map((c, i) => {
      const base = buildBaseFields(c, i, sourceFilename);
      const sourceImageTag = sourceImageTagFor(sourceFilename);

      if (mode === 'verbatim') {
        const shape = classifyVerbatimShape(c);
        const mcqCard =
          shape === 'mcq' ? buildMcqCard(c, base, sourceImageTag) : null;
        if (mcqCard != null) {
          mcqCount += 1;
          return mcqCard;
        }
        if (shape === 'basic' && looksLikeMcqAttempt(c)) mcqSkippedCount += 1;
        return buildBasicCard(c, base, sourceImageTag, shape === 'cloze');
      }

      if (mcqEnabled) {
        const mcqCard = buildMcqCard(c, base, sourceImageTag);
        if (mcqCard != null) {
          mcqCount += 1;
          return mcqCard;
        }
        if (looksLikeMcqAttempt(c)) mcqSkippedCount += 1;
      }

      return buildBasicCard(c, base, sourceImageTag, c.cloze ?? false);
    })
  );

  return { cards, mcqCount, mcqSkippedCount };
}

function buildDeckInfo(
  deckName: string,
  decks: CompactDeck[],
  sourceFilename: string | null,
  mode: PhotoMode,
  mcqEnabled: boolean
): BuildDeckInfoResult {
  const { cards, mcqCount, mcqSkippedCount } = buildDeckCards(
    decks,
    sourceFilename,
    mode,
    mcqEnabled
  );

  return {
    deckInfo: {
      name: deckName,
      id: Math.abs(
        Array.from(deckName).reduce(
          (h, ch) => Math.trunc(Math.imul(31, h) + (ch.codePointAt(0) ?? 0)),
          0
        )
      ),
      cards,
      style: null,
      settings: {
        template: 'specialstyle',
        clozeModelName: 'n2a-cloze',
        basicModelName: 'n2a-basic',
        inputModelName: 'n2a-input',
        useNotionId: false,
      },
    },
    mcqCount,
    mcqSkippedCount,
  };
}

export class PhotoToFlashcardsUseCase {
  constructor(private readonly events?: IEventsRepository) {}

  async generateCards(
    input: PhotoToFlashcardsInput
  ): Promise<PhotoVisionCards> {
    const userId = ownerToUserId(input.owner);

    if (!input.isPaying && this.events != null) {
      const used = await this.events.countByNameForUser(
        VISION_PHOTO_EVENT,
        startOfMonth(),
        userId,
        userId == null ? input.owner : null
      );
      if (used >= FREE_PHOTO_QUOTA_PER_MONTH) {
        throw makeFreeQuotaReachedError(used, FREE_PHOTO_QUOTA_PER_MONTH);
      }
    }

    const { tokens, tiles } = countVisionTokens({
      width: input.imageDimensions.width,
      height: input.imageDimensions.height,
      mediaType: input.mediaType,
    });

    const ceiling = input.tokenCeilingOverride ?? VISION_TOKEN_CEILING;

    if (tokens > ceiling) {
      throw makePayloadTooLargeError();
    }

    const client = getAnthropicClient();
    const mcqEnabled = (input.mcqEnabled ?? false) && input.isPaying;
    const mode = input.mode ?? DEFAULT_PHOTO_MODE;

    const createVisionMessage = (maxTokens: number) =>
      client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: input.mediaType,
                  data: input.imageBase64,
                },
              },
              {
                type: 'text',
                text: resolvePrompt(
                  mode,
                  input.cardStyle ?? DEFAULT_PHOTO_CARD_STYLE,
                  input.density ?? DEFAULT_PHOTO_DENSITY,
                  mcqEnabled
                ),
              },
            ],
          },
        ],
      });

    let response = await createVisionMessage(VISION_MAX_TOKENS);
    if (response.stop_reason === 'max_tokens') {
      console.warn(
        '[Claude] Vision response truncated at max_tokens, retrying',
        {
          source: 'photo',
          maxTokens: VISION_MAX_TOKENS,
          retryMaxTokens: VISION_RETRY_MAX_TOKENS,
        }
      );
      response = await createVisionMessage(VISION_RETRY_MAX_TOKENS);
    }

    const rawText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const decks = parseClaudeVisionResponse(rawText);
    const cardCount = decks.reduce((sum, d) => sum + d.cards.length, 0);

    const inputTokens = response.usage?.input_tokens ?? tokens;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const estimatedCostUsd =
      (inputTokens / 1_000_000) * INPUT_COST_PER_MILLION +
      (outputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION;

    const deckName = input.deckName || (decks[0]?.deck ?? 'Photo deck');

    track(VISION_PHOTO_EVENT, {
      userId,
      anonymousId: userId == null ? input.owner : null,
      props: {
        card_count: cardCount,
        tile_count: tiles,
        source_mode: mode,
        card_style: input.cardStyle ?? DEFAULT_PHOTO_CARD_STYLE,
        density: input.density ?? DEFAULT_PHOTO_DENSITY,
      },
    });

    return {
      decks,
      cards: flattenDecksToCards(decks),
      cardCount,
      deckName,
      estimatedCostUsd,
      tileCount: tiles,
      inputTokens,
      outputTokens,
    };
  }

  async execute(
    input: PhotoToFlashcardsInput
  ): Promise<PhotoToFlashcardsResult> {
    const {
      decks,
      deckName,
      cardCount,
      estimatedCostUsd,
      tileCount,
      inputTokens,
      outputTokens,
    } = await this.generateCards(input);

    const mcqEnabled = (input.mcqEnabled ?? false) && input.isPaying;
    const mode = input.mode ?? DEFAULT_PHOTO_MODE;

    const embedSourceImage = input.includeSourceImage ?? true;
    const sourceFilename = embedSourceImage
      ? `source-${randomUUID()}.${mediaTypeToExt(input.mediaType)}`
      : null;

    const workspaceDir = path.join(os.tmpdir(), `vision-${randomUUID()}`);
    fs.mkdirSync(workspaceDir, { recursive: true });

    const { deckInfo, mcqCount, mcqSkippedCount } = buildDeckInfo(
      deckName,
      decks,
      sourceFilename,
      mode,
      mcqEnabled
    );

    let apkgPath: string;
    try {
      if (sourceFilename != null) {
        fs.writeFileSync(
          path.join(workspaceDir, sourceFilename),
          Buffer.from(input.imageBase64, 'base64')
        );
      }
      fs.writeFileSync(
        path.join(workspaceDir, 'deck_info.json'),
        JSON.stringify([deckInfo]),
        'utf-8'
      );
      apkgPath = await runDeckBridge(workspaceDir);
    } catch (err) {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      throw err;
    }

    console.log(
      JSON.stringify({
        event: 'vision_call_success',
        estimated_cost_usd: estimatedCostUsd,
        tile_count: tileCount,
        media_type: input.mediaType,
        card_count: cardCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        mcq_count: mcqCount,
        mcq_skipped_count: mcqSkippedCount,
        source: 'photo',
      })
    );

    return {
      apkgPath,
      cardCount,
      estimatedCostUsd,
      tileCount,
      mcqCount,
      mcqSkippedCount,
    };
  }
}

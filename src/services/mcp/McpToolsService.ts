import express from 'express';
import { track } from '../events/track';
import { randomUUID } from 'node:crypto';
import imageSize from 'image-size';

import { JobWithDownloadKey } from '../../data_layer/JobRepository';
import UsersRepository from '../../data_layer/UsersRepository';
import ApkgPreviewService from '../ApkgPreviewService/ApkgPreviewService';
import DownloadService from '../DownloadService';
import StorageHandler from '../../lib/storage/StorageHandler';
import instrumentedAxios from '../observability/instrumentedAxios';
import { getSafeFilename } from '../../lib/getSafeFilename';
import getDeckFilename from '../../lib/anki/getDeckFilename';
import Workspace from '../../lib/parser/WorkSpace';
import CustomExporter from '../../lib/parser/exporters/CustomExporter';
import { isTypableAnswer } from '../../lib/parser/isTypableAnswer';
import {
  CheckMonthlyCardLimitUseCase,
  MONTHLY_CARD_LIMIT,
  MonthlyLimitError,
} from '../../usecases/users/CheckMonthlyCardLimitUseCase';
import { startOfNextMonthUtc } from '../../lib/User/startOfMonthUtc';
import { DeckPersistence } from './McpDeckPersistence';
import { McpCard, serializeCardsToMarkdown } from './serializeCardsToMarkdown';
import { groupCardsBySubdeck, hasSubdecks } from './composeSubdecks';
import { buildSubdeckDecks } from './buildSubdeckDecks';
import {
  McpConvertOptions,
  McpCreateDeckOptions,
  mcpOptionsToCardSettings,
} from './mcpOptionsToCardSettings';
import {
  AppliedOptions,
  IgnoredOption,
  buildAppliedOptions,
  hasClozeMarkup,
} from './buildAppliedOptions';
import type { ParsedApkg } from '../ApkgPreviewService/ApkgPreviewService';
import type { RenderedCard } from '../ApkgPreviewService/types';
import { cardTags, deckFacts } from './deckViewerFields';
import { detectFileMime } from '../../lib/detectFileMime';
import { isCSVFile } from '../../lib/storage/checks';
import { mcpBaseUrl } from './mcpBaseUrl';
import { isPaying } from '../../lib/isPaying';
import type { VisionMediaType } from '../../lib/claude/countVisionTokens';
import {
  PhotoToFlashcardsUseCase,
  type GeneratedFlashcard,
  type PhotoDensity,
  type PhotoMode,
} from '../../usecases/imageOcclusion/PhotoToFlashcardsUseCase';
import { hasVisibleContent } from '../../lib/parser/hasVisibleContent';

const APKG_KEY_PATTERN = /\.apkg$/i;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_URL_BYTES = 100 * 1024 * 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PREVIEW_CARD_LIMIT = 20;
const MAX_CARDS = 500;
const DEFAULT_DECK_NAME = 'MCP deck';
const DATA_URL_PREFIX = /^data:[^,]*,/;
const NO_CARDS_FOUND_MESSAGE =
  'No cards found in this text. If you already have front/back pairs, call create_deck with them — it needs no special formatting. Otherwise mark up the text with one of these structures and call convert_to_deck again: `front :: back` on its own line, `<details><summary>front</summary>back</details>`, or a `## front` heading with the answer on the line below. Full grammar: deck_capabilities → inputFormats.';
const EMPTY_BACK_MESSAGE =
  'Some cards have an empty back. Every card needs both a front and a back.';
const GENERIC_CONVERT_ERROR = 'Could not convert this input.';
const MONTHLY_LIMIT_CODE = 'monthly_limit';
const HELD_FOR_PLAN_CODE = 'held_for_plan';
const CARD_LIMIT_REDIRECT_PREFIX = '/limit?kind=card_count';
// Directory review rules allow a link to an informational plans page, never a
// page that starts a checkout. /pricing lists the plans and starts nothing on
// its own; the ref tags arrivals from a connector.
const PLANS_URL = 'https://2anki.net/pricing/?ref=mcp';

// The free card counter resets on the first day of each calendar month (UTC).
function nextMonthlyReset(now: Date = new Date()): string {
  return startOfNextMonthUtc(now).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// A deck is refused when it would take the month past the limit, which can
// happen with free cards still left, so the message never claims they are all
// used up.
function monthlyLimitMessage(heldBack: string): string {
  return `This deck would go over the free plan's ${MONTHLY_CARD_LIMIT} cards for this month, so it wasn't created.${heldBack} The count resets on ${nextMonthlyReset()}. Plan details: ${PLANS_URL}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function heldUntilFromHeaders(res: {
  get(name: string): string | undefined;
}): Date | null {
  const raw = res.get('X-Held-Until');
  if (
    res.get('X-Held-For-Plan') !== '1' ||
    raw == null ||
    !ISO_DATE.test(raw)
  ) {
    return null;
  }
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isFreePhotoQuotaError(
  error: unknown
): error is Error & { used: number; limit: number } {
  const candidate = error as {
    status?: unknown;
    used?: unknown;
    limit?: unknown;
  };
  return (
    error instanceof Error &&
    candidate.status === 429 &&
    typeof candidate.used === 'number' &&
    typeof candidate.limit === 'number'
  );
}

function freePhotoQuotaError(used: number, limit: number): Error {
  return Object.assign(
    new Error(
      `You've used all ${limit} free photos for this month. The count resets on ${nextMonthlyReset()}. Plan details: ${PLANS_URL}`
    ),
    { status: 429, used, limit }
  );
}

// MCP owners are the OAuth user id as a string; anything else has no user row.
function ownerToUserId(owner: string): number | null {
  const id = Number(owner);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function heldBackSentence(count: number): string {
  if (count === 1) return ' 1 card was held back.';
  return ` ${count} cards were held back.`;
}

function longDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const SHARE_PLANS_LINK =
  'Share the plans link with the user exactly as written, on its own line.';

function plansLines(plansUrl: string): string[] {
  return ['Plans on 2anki.net:', plansUrl, SHARE_PLANS_LINK];
}

function heldPlanStep(
  cardsHeldBack: number,
  cardsDelivered: number,
  heldUntil: Date | null
): McpNextStep {
  const plansUrl =
    heldUntil == null
      ? PLANS_URL
      : `${PLANS_URL}&held_until=${isoDate(heldUntil)}`;
  return {
    plans_url: plansUrl,
    upgrade_url: plansUrl,
    cards_held_back: cardsHeldBack,
    cards_delivered: cardsDelivered,
    ...(heldUntil == null ? {} : { held_until: isoDate(heldUntil) }),
  };
}

// The deck name reaches prose outside the untrusted-data wrapper, so it is
// kept to one short plain line that cannot open a tag or break out of quotes.
const MAX_NOTICE_DECK_NAME = 120;

function noticeDeckName(name: string): string {
  const plain = name
    .replace(/\.apkg$/i, '')
    .replace(/[\r\n\t"<>`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NOTICE_DECK_NAME)
    .trim();
  return plain.length > 0 ? plain : DEFAULT_DECK_NAME;
}

function partialDeliveryLines(
  delivered: number,
  heldBack: number,
  heldUntil: Date | null
): string[] {
  const total = delivered + heldBack;
  const first =
    delivered === 1
      ? `This deck has the first card of ${total}, which is what was left of this month's ${MONTHLY_CARD_LIMIT} free cards.`
      : `This deck has the first ${delivered} of ${total} cards, which is what was left of this month's ${MONTHLY_CARD_LIMIT} free cards.`;
  const others =
    heldBack === 1 ? 'The other card' : `The other ${heldBack} cards`;
  return [
    first,
    heldUntil == null
      ? `${others} could not be saved this time. With any plan, convert this again for the full ${total}-card deck.`
      : savedOthersLine(others, heldBack, total, heldUntil),
    `The free count resets on ${nextMonthlyReset()}.`,
  ];
}

function savedOthersLine(
  others: string,
  heldBack: number,
  total: number,
  heldUntil: Date
): string {
  const verb = heldBack === 1 ? 'is' : 'are';
  const pronoun = heldBack === 1 ? 'it' : 'them';
  return `${others} ${verb} saved on your 2anki account until ${longDate(heldUntil)}. Any plan unlocks ${pronoun}, and the full ${total}-card deck then appears in My decks on 2anki.net.`;
}

function heldForPlanLines(
  deckName: string,
  cardCount: number,
  heldUntil: Date
): string[] {
  const cards = cardCount === 1 ? '1 card' : `${cardCount} cards`;
  return [
    `Your deck "${deckName}" has ${cards} and is saved on your 2anki account until ${longDate(heldUntil)}. No deck file was made yet, because this month's ${MONTHLY_CARD_LIMIT} free cards are already used.`,
    'Any plan unlocks the full deck, and it then appears in My decks on 2anki.net.',
    `The free count resets on ${nextMonthlyReset()}, when you can make up to ${MONTHLY_CARD_LIMIT} cards again.`,
  ];
}

function trackPlanPaywall(owner: string, props: Record<string, unknown>) {
  track('paywall_shown', {
    userId: ownerToUserId(owner),
    props: { source: 'mcp', surface: 'mcp', kind: 'card_count', ...props },
  });
}

function heldForPlanResult(
  owner: string,
  deckName: string,
  cardCount: number,
  heldUntil: Date
): ConvertResult {
  trackPlanPaywall(owner, {
    cards_held_back: cardCount,
    held_for_plan: true,
    cards_delivered: 0,
  });
  const next_step = heldPlanStep(cardCount, 0, heldUntil);
  const name = noticeDeckName(deckName);
  return {
    kind: 'held',
    code: HELD_FOR_PLAN_CODE,
    deckName: name,
    cardCount,
    cards_held_back: cardCount,
    cards_delivered: 0,
    next_step,
    summary: `Deck saved for a plan: ${name}. ${cardCount === 1 ? '1 card' : `${cardCount} cards`}.`,
    plan_notice: [
      ...heldForPlanLines(name, cardCount, heldUntil),
      ...plansLines(next_step.plans_url),
    ].join('\n'),
  };
}

function monthlyLimitResult(
  owner: string,
  cardsHeldBack?: number
): ConvertResult {
  trackPlanPaywall(owner, {
    cards_held_back: cardsHeldBack ?? 0,
    held_for_plan: false,
    cards_delivered: 0,
  });
  const next_step: McpNextStep = {
    plans_url: PLANS_URL,
    upgrade_url: PLANS_URL,
  };
  let heldBack = '';
  if (cardsHeldBack != null && cardsHeldBack > 0) {
    next_step.cards_held_back = cardsHeldBack;
    heldBack = heldBackSentence(cardsHeldBack);
  }
  const message = monthlyLimitMessage(heldBack);
  return { kind: 'error', code: MONTHLY_LIMIT_CODE, message, next_step };
}
const OVER_SIZE_MESSAGE =
  'These cards are over the 5 MB limit. Split into smaller decks.';
const NO_CARD_CODES = new Set(['markdown_likely_lossy', 'empty_export']);
const ALLOWED_PHOTO_MEDIA_TYPES: VisionMediaType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

export interface PhotoDeckInput {
  image: string;
  density?: PhotoDensity;
  mode?: PhotoMode;
  includeSourceImage?: boolean;
}

export interface PhotoDeckResult {
  cards: GeneratedFlashcard[];
  count: number;
  summary: string;
}

interface DecodedPhoto {
  imageBase64: string;
  mediaType: VisionMediaType;
  width: number;
  height: number;
}

function isAllowedPhotoMediaType(
  value: string | null
): value is VisionMediaType {
  return (
    value != null && (ALLOWED_PHOTO_MEDIA_TYPES as string[]).includes(value)
  );
}

function decodePhotoInput(image: string): DecodedPhoto {
  const base64 = image.replace(DATA_URL_PREFIX, '').trim();
  if (base64.length === 0) {
    throw new Error('Provide a photo as a base64 string or data URL.');
  }

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) {
    throw new Error("Couldn't decode the photo. Check the base64 data.");
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new Error('Photo is over the 10 MB limit. Try a smaller image.');
  }

  const mediaType = detectFileMime(buffer);
  if (!isAllowedPhotoMediaType(mediaType)) {
    throw new Error('Unsupported image type. Use PNG, JPEG, WebP, or GIF.');
  }

  const dims = imageSize(buffer);
  if (dims.width == null || dims.height == null) {
    throw new Error("Couldn't read the photo's dimensions.");
  }

  return {
    imageBase64: base64,
    mediaType,
    width: dims.width,
    height: dims.height,
  };
}

function decodeFileNameHeader(raw: string | null): string | null {
  if (raw == null) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function subdeckSummary(
  title: string,
  cardCount: number,
  deckCount: number
): string {
  const cardLabel = cardCount === 1 ? 'card' : 'cards';
  const deckLabel = deckCount === 1 ? 'subdeck' : 'subdecks';
  return `Deck ready: ${title} — ${cardCount} ${cardLabel} across ${deckCount} ${deckLabel}.`;
}

export interface DeckSummary {
  jobId: string;
  title: string;
  status: string;
  downloadUrl: string | null;
}

export interface SampleCard {
  front: string;
  back: string;
  direction?: 'forward' | 'reverse';
  tags?: string[];
  deck?: string;
}

export interface DeckPreview {
  note?: string;
  cardCount: number;
  deckCount: number;
  decks: { name: string; cardCount: number }[];
  sampleCards: SampleCard[];
  noteCount?: number;
  noteTypes?: string[];
  tts?: true;
  title?: string;
  downloadUrl?: string;
}

type DeckPreviewFields = Pick<
  DeckPreview,
  'deckCount' | 'decks' | 'sampleCards' | 'noteCount' | 'noteTypes' | 'tts'
>;

export type ConvertResult =
  | { kind: 'processing'; jobId: string; summary: string }
  | {
      kind: 'batch';
      deckCount: number;
      decks: { name: string; downloadUrl: string }[];
      summary: string;
    }
  | {
      kind: 'deck';
      jobId?: string;
      cardCount: number | null;
      filename: string | null;
      downloadUrl?: string;
      deckCount?: number;
      decks?: { name: string; cardCount: number }[];
      sampleCards?: SampleCard[];
      noteCount?: number;
      noteTypes?: string[];
      tts?: true;
      applied?: AppliedOptions;
      ignored?: IgnoredOption[];
      summary: string;
      cards_held_back?: number;
      cards_delivered?: number;
      next_step?: McpNextStep;
      plan_notice?: string;
    }
  | {
      kind: 'held';
      code: 'held_for_plan';
      deckName: string;
      cardCount: number;
      cards_held_back: number;
      cards_delivered: number;
      next_step: McpNextStep;
      summary: string;
      plan_notice: string;
    }
  | { kind: 'error'; message: string; code?: string; next_step?: McpNextStep };

// Attached to a monthly-limit result so the assistant can relay the limit and
// where to read about plans in the same turn (#4393). The link is an
// informational page with no checkout. upgrade_url is a deprecated alias of
// plans_url, kept for one release for clients that already read it (#4790).
// held_until is set only when the cards over the limit are saved for a plan.
export interface McpNextStep {
  cards_held_back?: number;
  cards_delivered?: number;
  held_until?: string;
  plans_url: string;
  upgrade_url: string;
}

// Saves a connector source the monthly limit refused outright, so a plan
// bought later releases it. Resolves to the hold's expiry, or null when it
// could not be saved.
export interface ConnectorPlanHolds {
  holdForPlan(
    owner: string,
    file: UploadedFile,
    cardCount: number,
    cardOptions: Record<string, unknown>
  ): Promise<Date | null>;
}

export interface ConvertInput {
  url?: string;
  text?: string;
  filename?: string;
  options?: McpConvertOptions;
}

export interface JobLister {
  getJobsByOwner(owner: string): Promise<JobWithDownloadKey[]>;
}

export type UploadEntrypoint = (
  req: express.Request,
  res: express.Response
) => unknown;

interface UploadedFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

class CapturingResponse {
  statusCode = 200;
  body: unknown;
  bodyBuffer: Buffer | null = null;
  redirectedTo: string | null = null;
  private readonly headers = new Map<string, string>();
  locals: Record<string, unknown> = {};
  req: express.Request;

  constructor(req: express.Request) {
    this.req = req;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  set(field: string, value?: string): this {
    if (value != null) {
      this.headers.set(field.toLowerCase(), value);
    }
    return this;
  }

  setHeader(field: string, value: string): this {
    return this.set(field, value);
  }

  get(field: string): string | undefined {
    return this.headers.get(field.toLowerCase());
  }

  contentType(_value: string): this {
    return this;
  }

  attachment(_filename?: string): this {
    return this;
  }

  json(payload: unknown): this {
    this.body = payload;
    return this;
  }

  send(payload: unknown): this {
    if (Buffer.isBuffer(payload)) {
      this.bodyBuffer = payload;
    } else {
      this.body = payload;
    }
    return this;
  }

  redirect(target: string): this {
    this.redirectedTo = target;
    return this;
  }
}

export class McpToolsService {
  constructor(
    private readonly jobLister: JobLister,
    private readonly downloadService: DownloadService,
    private readonly previewService: ApkgPreviewService,
    private readonly uploadEntry: UploadEntrypoint,
    private readonly storage: StorageHandler,
    private readonly deckPersistence: DeckPersistence,
    private readonly photoToFlashcards: PhotoToFlashcardsUseCase,
    private readonly usersRepository: UsersRepository,
    private readonly planHolds: ConnectorPlanHolds,
    private readonly baseUrl: string = mcpBaseUrl()
  ) {}

  async photoToDeck(
    input: PhotoDeckInput,
    owner: string,
    locals: Record<string, unknown>
  ): Promise<PhotoDeckResult> {
    const photo = decodePhotoInput(input.image);
    const generated = await this.generatePhotoCards({
      imageBase64: photo.imageBase64,
      mediaType: photo.mediaType,
      deckName: '',
      owner,
      isPaying: isPaying(locals),
      imageDimensions: { width: photo.width, height: photo.height },
      includeSourceImage: input.includeSourceImage,
      density: input.density,
      mode: input.mode,
      usageSurface: 'photo_to_deck_mcp',
    });

    return {
      cards: generated.cards.map(({ front, back }) => ({ front, back })),
      count: generated.cardCount,
      summary: `${generated.cardCount} cards from your photo. Review them, then call create_deck to build and download the deck.`,
    };
  }

  private async generatePhotoCards(
    input: Parameters<PhotoToFlashcardsUseCase['generateCards']>[0]
  ) {
    try {
      return await this.photoToFlashcards.generateCards(input);
    } catch (error) {
      if (isFreePhotoQuotaError(error)) {
        throw freePhotoQuotaError(error.used, error.limit);
      }
      throw error;
    }
  }

  async listMyDecks(
    owner: string,
    limit = 20
  ): Promise<{ decks: DeckSummary[]; total: number; note?: string }> {
    const cappedLimit = Math.min(Math.max(limit, 1), 100);
    const jobs = await this.jobLister.getJobsByOwner(owner);
    const decks = jobs.slice(0, cappedLimit).map((job) => ({
      jobId: job.object_id,
      title: job.title ?? 'Untitled deck',
      status: job.status,
      downloadUrl:
        job.download_key != null ? this.jobDownloadUrl(job.object_id) : null,
    }));
    const result: { decks: DeckSummary[]; total: number; note?: string } = {
      decks,
      total: jobs.length,
    };
    if (jobs.length > decks.length) {
      result.note = `Showing ${decks.length} of ${jobs.length} decks, newest first. Pass a higher limit for more.`;
    }
    return result;
  }

  async getDeckPreview(
    owner: string,
    identifier: string,
    page = 0,
    pageSize = PREVIEW_CARD_LIMIT
  ): Promise<DeckPreview> {
    const { key, job } = await this.resolveDeckKey(owner, identifier);
    const body = await this.downloadService.getFileBody(
      owner,
      key,
      this.storage
    );
    if (!body) {
      throw new Error('Upload not found.');
    }
    const parsed = await this.previewService.parse(
      `${owner}:${key}`,
      body as Buffer
    );
    const meta = this.previewService.getMeta(parsed);
    const mediaBaseUrl = `/api/apkg/${encodeURIComponent(key)}/media/`;
    const cappedPageSize = Math.min(Math.max(pageSize, 1), 50);
    const safePage = Math.max(page, 0);
    const cardsPage = this.previewService.getCardsPage(
      parsed,
      safePage * cappedPageSize,
      cappedPageSize,
      mediaBaseUrl
    );
    const sampleCards = this.toSampleCards(
      parsed,
      cardsPage.cards,
      this.deckIsReversible(parsed),
      meta.decks.length > 1
    );
    const shownThrough = safePage * cappedPageSize + sampleCards.length;
    const preview: DeckPreview = {
      cardCount: meta.totalCards,
      deckCount: meta.decks.length,
      decks: meta.decks.map((deck) => ({
        name: deck.fullName,
        cardCount: deck.cardCount,
      })),
      sampleCards,
      ...deckFacts(parsed),
    };
    if (job != null) {
      if (job.title != null) preview.title = job.title;
      // A deck this server built keeps its no-login capability link; any
      // other job gets the signed-in link list_my_decks already returns.
      preview.downloadUrl =
        job.type === 'mcp'
          ? this.mcpDeckDownloadUrl(job.object_id)
          : this.jobDownloadUrl(job.object_id);
    }
    if (meta.totalCards > shownThrough) {
      preview.note = `Showing cards ${safePage * cappedPageSize + 1}–${shownThrough} of ${meta.totalCards}. Pass page (0-based) and pageSize for more.`;
    }
    return preview;
  }

  private async resolveDeckKey(
    owner: string,
    identifier: string
  ): Promise<{ key: string; job?: JobWithDownloadKey }> {
    const jobs = await this.jobLister.getJobsByOwner(owner);
    const job = jobs.find((entry) => entry.object_id === identifier);
    if (job) {
      const key = job.download_key;
      if (key == null || !APKG_KEY_PATTERN.test(key)) {
        throw new Error('This deck has no .apkg to preview yet.');
      }
      return { key, job };
    }
    if (APKG_KEY_PATTERN.test(identifier)) {
      return { key: identifier };
    }
    throw new Error('Deck not found.');
  }

  private jobDownloadUrl(objectId: string): string {
    return `${this.baseUrl}/api/upload/jobs/${objectId}/download`;
  }

  private mcpDeckDownloadUrl(objectId: string): string {
    return `${this.baseUrl}/api/mcp/decks/${objectId}/download`;
  }

  async convertToDeck(
    input: ConvertInput,
    owner: string,
    locals: Record<string, unknown>
  ): Promise<ConvertResult> {
    const file = await this.buildFile(input);
    if (file == null) {
      return {
        kind: 'error',
        message: 'Provide either a url or text to convert.',
      };
    }
    const res = await this.runUpload(
      file,
      locals,
      mcpOptionsToCardSettings(input.options)
    );
    const result = await this.mapUploadResult(res, owner, file.originalname);
    if (result.kind !== 'deck') {
      return result;
    }
    const clozePresent =
      input.options?.noteType === 'cloze'
        ? hasClozeMarkup(this.clozeCheckText(input, file))
        : false;
    const { applied, ignored } = buildAppliedOptions(
      input.options,
      clozePresent,
      true,
      Boolean(isCSVFile(file.originalname))
    );
    return { ...result, applied, ...(ignored ? { ignored } : {}) };
  }

  private clozeCheckText(input: ConvertInput, file: UploadedFile): string {
    if (typeof input.text === 'string' && input.text.length > 0) {
      return input.text;
    }
    return file.buffer.subarray(0, MAX_TEXT_BYTES).toString('utf-8');
  }

  async createDeck(
    cards: McpCard[],
    deckName: string | undefined,
    options: McpCreateDeckOptions | undefined,
    owner: string,
    locals: Record<string, unknown>
  ): Promise<ConvertResult> {
    if (!Array.isArray(cards) || cards.length === 0) {
      return { kind: 'error', message: 'Provide at least 1 card.' };
    }
    if (cards.length > MAX_CARDS) {
      return {
        kind: 'error',
        message: `Too many cards — the limit is ${MAX_CARDS}. Split into smaller decks.`,
      };
    }
    if (cards.some((card) => card.front == null || card.front.trim() === '')) {
      return { kind: 'error', message: 'Every card needs a non-empty front.' };
    }

    const title =
      deckName != null && deckName.trim().length > 0
        ? deckName.trim()
        : DEFAULT_DECK_NAME;

    if (hasSubdecks(cards)) {
      return this.createSubdeckDeck(cards, title, options, owner, locals);
    }

    const markdown = serializeCardsToMarkdown(cards);
    const buffer = Buffer.from(markdown, 'utf-8');
    if (buffer.byteLength > MAX_TEXT_BYTES) {
      return { kind: 'error', message: OVER_SIZE_MESSAGE };
    }

    const file: UploadedFile = {
      originalname: getSafeFilename(`${title}.md`),
      size: buffer.byteLength,
      buffer,
    };
    const res = await this.runUpload(file, locals, {
      deckName: title,
      ...mcpOptionsToCardSettings(options),
    });
    const result = await this.mapUploadResult(res, owner, title, cards.length);
    if (result.kind === 'error') {
      return this.isNoCardError(result) && this.everyBackEmpty(cards)
        ? { ...result, message: EMPTY_BACK_MESSAGE }
        : result;
    }
    if (result.kind !== 'deck') {
      return result;
    }
    const withCount =
      result.cardCount == null
        ? { ...result, cardCount: cards.length }
        : result;
    if (options == null) {
      return withCount;
    }
    const clozePresent =
      options.noteType === 'cloze' ? hasClozeMarkup(markdown) : false;
    const inputAnswerTypable =
      options.noteType === 'input'
        ? cards.every((card) => isTypableAnswer(card.back))
        : true;
    const { applied, ignored } = buildAppliedOptions(
      options,
      clozePresent,
      inputAnswerTypable
    );
    return {
      ...withCount,
      applied,
      ...(ignored ? { ignored } : {}),
    };
  }

  private async createSubdeckDeck(
    cards: McpCard[],
    title: string,
    options: McpCreateDeckOptions | undefined,
    owner: string,
    locals: Record<string, unknown>
  ): Promise<ConvertResult> {
    const combined = serializeCardsToMarkdown(cards);
    if (Buffer.byteLength(combined, 'utf-8') > MAX_TEXT_BYTES) {
      return { kind: 'error', message: OVER_SIZE_MESSAGE };
    }

    const totalCards = cards.length;
    try {
      await new CheckMonthlyCardLimitUseCase(this.usersRepository).execute({
        userId: owner,
        candidateCardCount: totalCards,
        isPaying: isPaying(locals),
      });
    } catch (error) {
      if (error instanceof MonthlyLimitError) {
        return monthlyLimitResult(owner, totalCards);
      }
      throw error;
    }

    const groups = groupCardsBySubdeck(title, cards);
    const workspace = new Workspace(true, 'fs');
    const exporter = new CustomExporter(title, workspace.location);
    exporter.configure(buildSubdeckDecks(groups));
    const apkg = await exporter.save();

    const filename = getDeckFilename(title);
    const objectId = randomUUID();
    await this.deckPersistence.persist(owner, objectId, filename, apkg);
    await this.usersRepository.incrementCardUsage(owner, totalCards);

    const preview = await this.previewFromBytes(apkg, `mcp:${objectId}`);
    const subdecks = groups
      .map((group) => ({ deck: group.deck, cards: group.cards.length }))
      .sort((a, b) => a.deck.localeCompare(b.deck));
    const applied: AppliedOptions = {
      noteType: 'basic',
      tags: [],
      tts: { enabled: false },
      subdecks,
    };
    const ignored = this.subdeckIgnoredOptions(options);
    return {
      kind: 'deck',
      jobId: objectId,
      cardCount: totalCards,
      filename,
      downloadUrl: this.mcpDeckDownloadUrl(objectId),
      ...preview,
      applied,
      ...(ignored ? { ignored } : {}),
      summary: subdeckSummary(title, totalCards, subdecks.length),
    };
  }

  private subdeckIgnoredOptions(
    options: McpCreateDeckOptions | undefined
  ): IgnoredOption[] | undefined {
    const ignored: IgnoredOption[] = [];
    if (options?.noteType != null && options.noteType !== 'basic') {
      ignored.push({
        option: 'noteType',
        requested: options.noteType,
        reason:
          'Cards with a deck field always build as Basic; noteType only applies when no card sets deck.',
      });
    }
    if (options?.tags != null && options.tags.length > 0) {
      ignored.push({
        option: 'tags',
        requested: options.tags,
        reason:
          'Cards with a deck field always build with no tags; tags only apply when no card sets deck.',
      });
    }
    return ignored.length > 0 ? ignored : undefined;
  }

  // Only a no-cards failure is about the backs; a card-limit or server error
  // keeps its own message even when every back happens to be blank.
  private isNoCardError(result: ConvertResult): boolean {
    return (
      result.kind === 'error' &&
      result.code != null &&
      NO_CARD_CODES.has(result.code)
    );
  }

  private everyBackEmpty(cards: McpCard[]): boolean {
    return cards.every((card) => !hasVisibleContent(card.back));
  }

  private async runUpload(
    file: UploadedFile,
    locals: Record<string, unknown>,
    body: Record<string, unknown> = {}
  ): Promise<CapturingResponse> {
    const req = {
      files: [file],
      body,
      headers: {},
      cookies: {},
    } as unknown as express.Request;
    const res = new CapturingResponse(req);
    // The synthetic request carries no headers or path, so nothing downstream
    // can tell an MCP conversion from a browser upload. UploadService reads this
    // to record the entry point on the conversion score.
    res.locals = { ...locals, mcp_auth: true };
    await this.uploadEntry(req, res as unknown as express.Response);
    return res;
  }

  private async previewFromBytes(
    buffer: Buffer,
    cacheKey: string
  ): Promise<DeckPreviewFields | null> {
    try {
      const parsed = await this.previewService.parse(cacheKey, buffer);
      const meta = this.previewService.getMeta(parsed);
      const page = this.previewService.getCardsPage(
        parsed,
        0,
        PREVIEW_CARD_LIMIT,
        ''
      );
      const reversible = this.deckIsReversible(parsed);
      const multiDeck = meta.decks.length > 1;
      const sampleCards = this.toSampleCards(
        parsed,
        page.cards,
        reversible,
        multiDeck
      );
      this.ensureReverseSample(parsed, reversible, multiDeck, sampleCards);
      return {
        deckCount: meta.decks.length,
        decks: meta.decks.map((deck) => ({
          name: deck.fullName,
          cardCount: deck.cardCount,
        })),
        sampleCards,
        ...deckFacts(parsed),
      };
    } catch {
      return null;
    }
  }

  private deckIsReversible(parsed: ParsedApkg): boolean {
    const noteTypes = parsed.collection?.noteTypes;
    if (!(noteTypes instanceof Map)) {
      return false;
    }
    for (const noteType of noteTypes.values()) {
      if (
        noteType.type === 0 &&
        Array.isArray(noteType.templates) &&
        noteType.templates.length >= 2
      ) {
        return true;
      }
    }
    return false;
  }

  private toSampleCards(
    parsed: ParsedApkg,
    cards: RenderedCard[],
    reversible: boolean,
    multiDeck: boolean
  ): SampleCard[] {
    return cards.map((card) =>
      this.toSampleCard(parsed, card, reversible, multiDeck)
    );
  }

  // tags and deck are set only when they carry information, so a plain
  // single-deck sample keeps the { front, back } shape it always had.
  private toSampleCard(
    parsed: ParsedApkg,
    card: RenderedCard,
    reversible: boolean,
    multiDeck: boolean
  ): SampleCard {
    const sample: SampleCard = { front: card.front, back: card.back };
    if (reversible) {
      sample.direction = card.ord === 0 ? 'forward' : 'reverse';
    }
    const tags = cardTags(parsed, card.id);
    if (tags.length > 0) sample.tags = tags;
    if (multiDeck && card.deckName.length > 0) sample.deck = card.deckName;
    return sample;
  }

  private ensureReverseSample(
    parsed: ParsedApkg,
    reversible: boolean,
    multiDeck: boolean,
    sampleCards: SampleCard[]
  ): void {
    if (!reversible) {
      return;
    }
    if (sampleCards.some((card) => card.direction === 'reverse')) {
      return;
    }
    const reverseIndex = parsed.collection.cards.findIndex(
      (card) => card.ord >= 1
    );
    if (reverseIndex < 0) {
      return;
    }
    const extra = this.previewService.getCardsPage(parsed, reverseIndex, 1, '');
    const card = extra.cards[0];
    if (card) {
      sampleCards.push(this.toSampleCard(parsed, card, true, multiDeck));
    }
  }

  private async buildFile(input: ConvertInput): Promise<UploadedFile | null> {
    if (typeof input.text === 'string' && input.text.length > 0) {
      const buffer = Buffer.from(input.text, 'utf-8');
      if (buffer.byteLength > MAX_TEXT_BYTES) {
        throw new Error('Text is over the 5 MB limit. Try splitting it.');
      }
      const name = getSafeFilename(input.filename ?? 'deck.md');
      return { originalname: name, size: buffer.byteLength, buffer };
    }
    if (typeof input.url === 'string' && input.url.length > 0) {
      const response = await instrumentedAxios.get<ArrayBuffer>(
        'mcp',
        input.url,
        { responseType: 'arraybuffer', maxContentLength: MAX_URL_BYTES }
      );
      const buffer = Buffer.from(response.data);
      const name = getSafeFilename(
        input.filename ?? this.filenameFromUrl(input.url)
      );
      return { originalname: name, size: buffer.byteLength, buffer };
    }
    return null;
  }

  private filenameFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const last = parsed.pathname.split('/').filter(Boolean).pop();
      return last && last.length > 0 ? last : 'deck.html';
    } catch {
      return 'deck.html';
    }
  }

  private async mapUploadResult(
    res: CapturingResponse,
    owner: string,
    fallbackTitle: string,
    candidateCards?: number
  ): Promise<ConvertResult> {
    if (res.statusCode === 202 && this.isJobBody(res.body)) {
      return {
        kind: 'processing',
        jobId: res.body.jobId,
        summary: 'Your deck is generating. Check list_my_decks for the result.',
      };
    }
    if (this.isBatchBody(res.body)) {
      const decks = res.body.decks.map((deck) => ({
        name: deck.name,
        downloadUrl: deck.downloadUrl,
      }));
      return {
        kind: 'batch',
        deckCount: decks.length,
        decks,
        summary: `${decks.length} decks ready to download.`,
      };
    }
    if (res.statusCode === 200 && res.bodyBuffer != null) {
      return this.persistDeckResult(res.bodyBuffer, res, owner, fallbackTitle);
    }
    if (res.redirectedTo?.startsWith(CARD_LIMIT_REDIRECT_PREFIX)) {
      return (
        (await this.holdOverLimitDeck(res, owner, fallbackTitle)) ??
        monthlyLimitResult(owner, candidateCards)
      );
    }
    const code = this.errorCode(res.body);
    return {
      kind: 'error',
      message: this.errorMessage(res.body, code),
      ...(code != null ? { code } : {}),
    };
  }

  private async holdOverLimitDeck(
    res: CapturingResponse,
    owner: string,
    fallbackTitle: string
  ): Promise<ConvertResult | null> {
    const overLimit = Number(res.get('X-Cards-Over-Limit'));
    const file = (res.req.files as unknown as UploadedFile[] | undefined)?.[0];
    if (!Number.isInteger(overLimit) || overLimit <= 0 || file == null) {
      return null;
    }
    const body = (res.req.body ?? {}) as Record<string, unknown>;
    const heldUntil = await this.planHolds.holdForPlan(
      owner,
      file,
      overLimit,
      body
    );
    if (heldUntil == null) {
      return null;
    }
    const deckName =
      typeof body.deckName === 'string' && body.deckName.trim() !== ''
        ? body.deckName
        : fallbackTitle.replace(/\.[^.]+$/, '');
    return heldForPlanResult(owner, deckName, overLimit, heldUntil);
  }

  private async persistDeckResult(
    bytes: Buffer,
    res: CapturingResponse,
    owner: string,
    fallbackTitle: string
  ): Promise<ConvertResult> {
    const cardCountHeader = res.get('X-Card-Count');
    const cardCount = cardCountHeader != null ? Number(cardCountHeader) : null;
    const filename = decodeFileNameHeader(res.get('File-Name') ?? null);
    const title = filename ?? fallbackTitle;
    const objectId = randomUUID();
    await this.deckPersistence.persist(owner, objectId, title, bytes);
    const downloadUrl = this.mcpDeckDownloadUrl(objectId);
    const preview = await this.previewFromBytes(bytes, `mcp:${objectId}`);
    const heldBack = Number(res.get('X-Cards-Held-Back') ?? 0);
    if (cardCount != null && Number.isInteger(heldBack) && heldBack > 0) {
      return {
        kind: 'deck',
        jobId: objectId,
        cardCount,
        filename,
        downloadUrl,
        ...preview,
        ...this.partialDeliveryFields(res, owner, title, cardCount, heldBack),
      };
    }
    const summary =
      cardCount != null
        ? `${cardCount} cards. Ready to download.`
        : 'Deck ready to download.';
    return {
      kind: 'deck',
      jobId: objectId,
      cardCount,
      filename,
      downloadUrl,
      ...preview,
      summary,
    };
  }

  private partialDeliveryFields(
    res: CapturingResponse,
    owner: string,
    title: string,
    delivered: number,
    heldBack: number
  ) {
    const heldUntil = heldUntilFromHeaders(res);
    trackPlanPaywall(owner, {
      partial: true,
      cards_held_back: heldBack,
      held_for_plan: heldUntil != null,
      cards_delivered: delivered,
    });
    const next_step = heldPlanStep(heldBack, delivered, heldUntil);
    return {
      summary: `Deck ready: ${noticeDeckName(title)}. ${delivered} of ${delivered + heldBack} cards.`,
      cards_held_back: heldBack,
      cards_delivered: delivered,
      next_step,
      plan_notice: [
        ...partialDeliveryLines(delivered, heldBack, heldUntil),
        ...plansLines(next_step.plans_url),
      ].join('\n'),
    };
  }

  private isJobBody(body: unknown): body is { jobId: string } {
    return (
      typeof body === 'object' &&
      body != null &&
      typeof (body as { jobId?: unknown }).jobId === 'string'
    );
  }

  private isBatchBody(
    body: unknown
  ): body is { kind: 'batch'; decks: { name: string; downloadUrl: string }[] } {
    return (
      typeof body === 'object' &&
      body != null &&
      (body as { kind?: unknown }).kind === 'batch' &&
      Array.isArray((body as { decks?: unknown }).decks)
    );
  }

  private errorCode(body: unknown): string | undefined {
    if (
      typeof body === 'object' &&
      body != null &&
      typeof (body as { code?: unknown }).code === 'string'
    ) {
      return (body as { code: string }).code;
    }
    return undefined;
  }

  private errorMessage(body: unknown, code: string | undefined): string {
    if (code != null && NO_CARD_CODES.has(code)) {
      return NO_CARDS_FOUND_MESSAGE;
    }
    if (
      typeof body === 'object' &&
      body != null &&
      typeof (body as { message?: unknown }).message === 'string'
    ) {
      return (body as { message: string }).message;
    }
    return GENERIC_CONVERT_ERROR;
  }
}

import express from 'express';
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
import {
  CheckMonthlyCardLimitUseCase,
  MonthlyLimitError,
} from '../../usecases/users/CheckMonthlyCardLimitUseCase';
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
import { detectFileMime } from '../../lib/detectFileMime';
import { mcpBaseUrl } from './mcpBaseUrl';
import { isPaying } from '../../lib/isPaying';
import type { VisionMediaType } from '../../lib/claude/countVisionTokens';
import {
  PhotoToFlashcardsUseCase,
  type GeneratedFlashcard,
  type PhotoDensity,
  type PhotoMode,
} from '../../usecases/imageOcclusion/PhotoToFlashcardsUseCase';

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
const MONTHLY_LIMIT_MESSAGE =
  "You've reached your free limit of 100 cards this month, so this deck wasn't created. Upgrade to Unlimited to keep converting, or wait for your limit to reset next month. Upgrade: https://2anki.net/pricing?from=mcp";
const CARD_LIMIT_REDIRECT_PREFIX = '/limit?kind=card_count';
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
  createdAt: string | null;
  downloadUrl: string | null;
}

export interface SampleCard {
  front: string;
  back: string;
  direction?: 'forward' | 'reverse';
}

export interface DeckPreview {
  note?: string;
  cardCount: number;
  deckCount: number;
  decks: { id: number; name: string; cardCount: number }[];
  sampleCards: SampleCard[];
}

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
      decks?: { id: number; name: string; cardCount: number }[];
      sampleCards?: SampleCard[];
      applied?: AppliedOptions;
      ignored?: IgnoredOption[];
      summary: string;
    }
  | { kind: 'error'; message: string; code?: string };

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
    private readonly baseUrl: string = mcpBaseUrl()
  ) {}

  async photoToDeck(
    input: PhotoDeckInput,
    owner: string,
    locals: Record<string, unknown>
  ): Promise<PhotoDeckResult> {
    const photo = decodePhotoInput(input.image);
    const generated = await this.photoToFlashcards.generateCards({
      imageBase64: photo.imageBase64,
      mediaType: photo.mediaType,
      deckName: '',
      owner,
      isPaying: isPaying(locals),
      imageDimensions: { width: photo.width, height: photo.height },
      includeSourceImage: input.includeSourceImage,
      density: input.density,
      mode: input.mode,
    });

    return {
      cards: generated.cards,
      count: generated.cardCount,
      summary: `${generated.cardCount} cards from your photo. Review them, then call create_deck to build and download the deck.`,
    };
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
      createdAt: job.created_at ? new Date(job.created_at).toISOString() : null,
      downloadUrl:
        job.download_key != null
          ? `${this.baseUrl}/api/upload/jobs/${job.object_id}/download`
          : null,
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
    const key = await this.resolveDeckKey(owner, identifier);
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
      cardsPage.cards,
      this.deckIsReversible(parsed)
    );
    const shownThrough = safePage * cappedPageSize + sampleCards.length;
    const preview: DeckPreview = {
      cardCount: meta.totalCards,
      deckCount: meta.decks.length,
      decks: meta.decks.map((deck) => ({
        id: deck.id,
        name: deck.fullName,
        cardCount: deck.cardCount,
      })),
      sampleCards,
    };
    if (meta.totalCards > shownThrough) {
      preview.note = `Showing cards ${safePage * cappedPageSize + 1}–${shownThrough} of ${meta.totalCards}. Pass page (0-based) and pageSize for more.`;
    }
    return preview;
  }

  private async resolveDeckKey(
    owner: string,
    identifier: string
  ): Promise<string> {
    const jobs = await this.jobLister.getJobsByOwner(owner);
    const job = jobs.find((entry) => entry.object_id === identifier);
    if (job) {
      const key = job.download_key;
      if (key == null || !APKG_KEY_PATTERN.test(key)) {
        throw new Error('This deck has no .apkg to preview yet.');
      }
      return key;
    }
    if (APKG_KEY_PATTERN.test(identifier)) {
      return identifier;
    }
    throw new Error('Deck not found.');
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
      clozePresent
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
    const result = await this.mapUploadResult(res, owner, title);
    if (result.kind === 'error') {
      return this.everyBackEmpty(cards)
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
    const { applied, ignored } = buildAppliedOptions(options, clozePresent);
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
        return {
          kind: 'error',
          code: MONTHLY_LIMIT_CODE,
          message: MONTHLY_LIMIT_MESSAGE,
        };
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
      splitByHeadings: false,
      tts: { enabled: false },
      subdecks,
    };
    const ignored = this.subdeckIgnoredOptions(options);
    return {
      kind: 'deck',
      jobId: objectId,
      cardCount: totalCards,
      filename,
      downloadUrl: `${this.baseUrl}/api/mcp/decks/${objectId}/download`,
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

  private everyBackEmpty(cards: McpCard[]): boolean {
    return cards.every((card) => card.back == null || card.back.trim() === '');
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
    res.locals = locals;
    await this.uploadEntry(req, res as unknown as express.Response);
    return res;
  }

  private async previewFromBytes(
    buffer: Buffer,
    cacheKey: string
  ): Promise<Pick<DeckPreview, 'deckCount' | 'decks' | 'sampleCards'> | null> {
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
      const sampleCards = this.toSampleCards(page.cards, reversible);
      this.ensureReverseSample(parsed, reversible, sampleCards);
      return {
        deckCount: meta.decks.length,
        decks: meta.decks.map((deck) => ({
          id: deck.id,
          name: deck.fullName,
          cardCount: deck.cardCount,
        })),
        sampleCards,
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
    cards: RenderedCard[],
    reversible: boolean
  ): SampleCard[] {
    return cards.map((card) => this.toSampleCard(card, reversible));
  }

  private toSampleCard(card: RenderedCard, reversible: boolean): SampleCard {
    if (!reversible) {
      return { front: card.front, back: card.back };
    }
    const direction: 'forward' | 'reverse' =
      card.ord === 0 ? 'forward' : 'reverse';
    return { front: card.front, back: card.back, direction };
  }

  private ensureReverseSample(
    parsed: ParsedApkg,
    reversible: boolean,
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
      sampleCards.push(this.toSampleCard(card, true));
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
    fallbackTitle: string
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
      return {
        kind: 'error',
        code: MONTHLY_LIMIT_CODE,
        message: MONTHLY_LIMIT_MESSAGE,
      };
    }
    const code = this.errorCode(res.body);
    return {
      kind: 'error',
      message: this.errorMessage(res.body, code),
      ...(code != null ? { code } : {}),
    };
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
    const downloadUrl = `${this.baseUrl}/api/mcp/decks/${objectId}/download`;
    const preview = await this.previewFromBytes(bytes, `mcp:${objectId}`);
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

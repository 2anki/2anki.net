import {
  WaitAbandonedError,
  type WeightedSemaphore,
} from '../../lib/rateLimit/WeightedSemaphore';
import { composeOcclusionSvg } from './composeOcclusionSvg';
import { estimateParsedBytes } from './estimateParsedBytes';
import { extractApkg, parseMediaManifest } from './extractApkg';
import type { ParseCacheBudget } from './ParseCacheBudget';
import {
  coldLoadWeight,
  PREVIEW_READ_TIME_LIMIT_MS,
  sharedPreviewLimits,
} from './previewMemoryLimits';
import { SharedInterest } from './SharedInterest';
import { parseCollection } from './parseCollection';
import { parseOcclusionField } from './parseOcclusionField';
import { applyClozeToFields } from './renderCloze';
import {
  buildFieldMap,
  renderTemplate,
  TemplateSpecials,
} from './renderTemplate';
import { EditableField, resolveEditableFields } from './resolveEditableFields';
import { rewriteMediaRefs } from './rewriteMedia';
import {
  extractTemplateStyles,
  sanitizeCardHtml,
  sanitizeCss,
} from './sanitize';
import {
  DeckMeta,
  EditableFieldValue,
  EditableRenderedCard,
  NormalizedCollection,
  Note,
  NoteType,
  PreviewMeta,
  RenderedCard,
} from './types';

const MAX_CACHE_ENTRIES = 8;
const CACHE_TTL_MS = 10 * 60 * 1000;

// 2anki's own n2a-mcq note type builds its option list client-side from
// this raw string (split on `<br>`) via a script the PDF/preview/share
// surfaces strip for security — so it has to be rendered statically here.
const MCQ_OPTION_SPLIT_REGEX = /<br\s*\/?>/gi; // NOSONAR

function splitMcqField(raw: string): string[] {
  return raw
    .split(MCQ_OPTION_SPLIT_REGEX)
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
}

function mcqPlainText(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

export interface ParsedApkg {
  collection: NormalizedCollection;
  mediaMap: Map<string, string>;
  mediaEntries: Map<string, Buffer>;
  parsedAt: number;
}

export interface CardRenderOptions {
  // Render for the PDF export: keep element ids, drop buttons, and carry
  // template <style> blocks into `css`. See sanitizeCardHtml.
  print?: boolean;
}

export interface DeckSource {
  storedSize: () => Promise<number>;
  read: (signal: AbortSignal) => Promise<Buffer | null | undefined>;
}

export class PreviewReadTimedOutError extends Error {
  constructor() {
    super('Could not load the deck.');
    this.name = 'PreviewReadTimedOutError';
  }
}

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export interface PreviewMemoryLimits {
  coldLoads: WeightedSemaphore;
  cacheBudget: ParseCacheBudget;
  now: () => number;
}

interface InFlightLoad {
  promise: Promise<ParsedApkg | null>;
  interest: SharedInterest;
}

export default class ApkgPreviewService {
  private readonly cache = new Map<string, ParsedApkg>();
  private readonly inFlight = new Map<string, InFlightLoad>();
  private readonly limits: PreviewMemoryLimits;

  constructor(limits: Partial<PreviewMemoryLimits> = {}) {
    const shared = sharedPreviewLimits();
    this.limits = {
      coldLoads: limits.coldLoads ?? shared.coldLoads,
      cacheBudget: limits.cacheBudget ?? shared.cacheBudget,
      now: limits.now ?? Date.now,
    };
  }

  async parse(cacheKey: string, bytes: Buffer): Promise<ParsedApkg> {
    const inMemory: DeckSource = {
      storedSize: async () => bytes.length,
      read: async () => bytes,
    };
    return (await this.load(cacheKey, inMemory)) as ParsedApkg;
  }

  load(
    cacheKey: string,
    source: DeckSource,
    signal?: AbortSignal
  ): Promise<ParsedApkg | null> {
    const cached = this.fromCache(cacheKey);
    if (cached) return Promise.resolve(cached);
    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      pending.interest.join(signal);
      return pending.promise;
    }
    const interest = new SharedInterest(() => {
      if (this.inFlight.get(cacheKey) === entry) this.inFlight.delete(cacheKey);
    });
    const entry: InFlightLoad = {
      interest,
      promise: this.loadCold(cacheKey, source, interest).finally(() => {
        if (this.inFlight.get(cacheKey) === entry) {
          this.inFlight.delete(cacheKey);
        }
      }),
    };
    this.inFlight.set(cacheKey, entry);
    interest.join(signal);
    return entry.promise;
  }

  private fromCache(cacheKey: string): ParsedApkg | null {
    const existing = this.cache.get(cacheKey);
    if (existing == null) return null;
    if (this.isExpired(existing)) {
      this.drop(cacheKey, existing);
      return null;
    }
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, existing);
    this.limits.cacheBudget.touch(existing);
    return existing;
  }

  private isExpired(parsed: ParsedApkg): boolean {
    return this.limits.now() - parsed.parsedAt >= CACHE_TTL_MS;
  }

  private drop(cacheKey: string, parsed: ParsedApkg): void {
    if (this.cache.get(cacheKey) === parsed) this.cache.delete(cacheKey);
    this.limits.cacheBudget.forget(parsed);
  }

  // Reads a stored deck and runs `work` on its bytes under the same shared
  // limit as a cold load, for callers that need the archive itself rather
  // than the parsed deck. `work` must not wait on the network or on this
  // service: the place is held until it settles.
  async withStoredDeck<T>(
    source: DeckSource,
    work: (bytes: Buffer) => Promise<T>,
    signal: AbortSignal = new AbortController().signal
  ): Promise<T | null> {
    const release = await this.acquireColdLoad(
      await source.storedSize(),
      signal
    );
    try {
      const bytes = await this.readWithinLimit(source, signal);
      if (bytes == null) return null;
      return await work(bytes);
    } finally {
      release();
    }
  }

  private async acquireColdLoad(
    storedBytes: number,
    signal: AbortSignal
  ): Promise<() => void> {
    const weight = coldLoadWeight(storedBytes);
    const { coldLoads } = this.limits;
    const queuedAhead = coldLoads.wouldWait(weight) ? coldLoads.waiting : null;
    const queuedAt = this.limits.now();
    const release = await coldLoads.acquire(weight, signal);
    if (queuedAhead != null) {
      console.info('[apkg-preview] cold load waited for a slot', {
        waitedMs: this.limits.now() - queuedAt,
        queuedAhead,
      });
    }
    return release;
  }

  private async loadCold(
    cacheKey: string,
    source: DeckSource,
    interest: SharedInterest
  ): Promise<ParsedApkg | null> {
    const release = await this.acquireColdLoad(
      await source.storedSize(),
      interest.signal
    );
    try {
      const bytes = await this.readWithinLimit(source, interest.signal);
      interest.commit();
      if (bytes == null) return null;
      return await this.parseFresh(cacheKey, bytes);
    } finally {
      release();
    }
  }

  // Only the storage read waits on anything outside the process; the parse
  // after it works on bytes already in memory.
  private async readWithinLimit(
    source: DeckSource,
    callerGone: AbortSignal
  ): Promise<Buffer | null | undefined> {
    const timeLimit = new AbortController();
    const timer = setTimeout(
      () => timeLimit.abort(),
      PREVIEW_READ_TIME_LIMIT_MS
    );
    const signal = AbortSignal.any([timeLimit.signal, callerGone]);
    try {
      return await untilAborted(source.read(signal), signal);
    } catch (error) {
      if (callerGone.aborted) throw new WaitAbandonedError();
      if (timeLimit.signal.aborted) {
        console.info('[apkg-preview] stored deck read stopped at time limit');
        throw new PreviewReadTimedOutError();
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseFresh(
    cacheKey: string,
    bytes: Buffer
  ): Promise<ParsedApkg> {
    const archive = await extractApkg(bytes);
    const collection = parseCollection(archive.collectionBuffer);
    const mediaMap = parseMediaManifest(archive.mediaManifestRaw);
    const parsed: ParsedApkg = {
      collection,
      mediaMap,
      mediaEntries: archive.mediaEntries,
      parsedAt: this.limits.now(),
    };
    this.remember(cacheKey, parsed);
    return parsed;
  }

  private remember(cacheKey: string, parsed: ParsedApkg): void {
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) this.drop(key, entry);
    }
    const previous = this.cache.get(cacheKey);
    if (previous != null) this.drop(cacheKey, previous);
    const admitted = this.limits.cacheBudget.admit(
      parsed,
      estimateParsedBytes(parsed),
      () => {
        if (this.cache.get(cacheKey) === parsed) this.cache.delete(cacheKey);
      }
    );
    if (!admitted) {
      console.info('[apkg-preview] parsed deck served without caching');
      return;
    }
    this.cache.set(cacheKey, parsed);
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.entries().next().value;
      if (oldest == null) break;
      this.drop(oldest[0], oldest[1]);
    }
  }

  getMeta(parsed: ParsedApkg): PreviewMeta {
    const counts = new Map<number, number>();
    for (const card of parsed.collection.cards) {
      counts.set(card.did, (counts.get(card.did) ?? 0) + 1);
    }
    const decks: DeckMeta[] = Array.from(parsed.collection.decks.values())
      .filter((deck) => (counts.get(deck.id) ?? 0) > 0)
      .map((deck) => ({
        id: deck.id,
        fullName: deck.name,
        path: deck.name.split('::'),
        cardCount: counts.get(deck.id) ?? 0,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    return {
      totalCards: parsed.collection.cards.length,
      decks,
    };
  }

  getMediaEntry(parsed: ParsedApkg, originalName: string): Buffer | null {
    const archiveName = parsed.mediaMap.get(originalName);
    if (!archiveName) return null;
    return parsed.mediaEntries.get(archiveName) ?? null;
  }

  getCardsPage(
    parsed: ParsedApkg,
    cursor: number,
    pageSize: number,
    mediaBaseUrl: string,
    deckId: number | null = null,
    options: CardRenderOptions = {}
  ): { cards: RenderedCard[]; nextCursor: number | null; total: number } {
    const all =
      deckId == null
        ? parsed.collection.cards
        : parsed.collection.cards.filter((card) => card.did === deckId);
    const end = Math.min(all.length, cursor + pageSize);
    const slice = all.slice(cursor, end);
    const cards: RenderedCard[] = [];
    for (const card of slice) {
      const rendered = this.renderCard(parsed, card.id, mediaBaseUrl, options);
      if (rendered) cards.push(rendered);
    }
    return {
      cards,
      nextCursor: end < all.length ? end : null,
      total: all.length,
    };
  }

  getEditableCardsPage(
    parsed: ParsedApkg,
    cursor: number,
    pageSize: number,
    mediaBaseUrl: string,
    deckId: number | null = null
  ): {
    cards: EditableRenderedCard[];
    nextCursor: number | null;
    total: number;
  } {
    const page = this.getCardsPage(
      parsed,
      cursor,
      pageSize,
      mediaBaseUrl,
      deckId
    );
    return {
      ...page,
      cards: page.cards.map((card) => ({
        ...card,
        editable: this.editableFieldValues(parsed, card.id),
      })),
    };
  }

  private editableFieldValues(
    parsed: ParsedApkg,
    cardId: number
  ): EditableRenderedCard['editable'] {
    const card = parsed.collection.cards.find((c) => c.id === cardId);
    const note = card ? parsed.collection.notes.get(card.nid) : undefined;
    const noteType = note
      ? parsed.collection.noteTypes.get(note.mid)
      : undefined;
    if (card == null || note == null || noteType == null) {
      return { front: null, back: null };
    }
    const sides = resolveEditableFields(noteType, card.ord);
    const withValue = (
      side: EditableField | null
    ): EditableFieldValue | null => {
      if (side == null || side.fieldIndex >= note.fields.length) return null;
      return { ...side, value: note.fields[side.fieldIndex] };
    };
    return { front: withValue(sides.front), back: withValue(sides.back) };
  }

  private isImageOcclusionTemplate(qfmt: string): boolean {
    return qfmt.includes('image-occlusion-canvas');
  }

  private renderIoCard(
    card: { id: number; ord: number },
    note: Note,
    noteType: NoteType,
    deck: { id: number; name: string } | undefined,
    mediaMap: Map<string, string>,
    mediaBaseUrl: string
  ): RenderedCard {
    const fieldMap = buildFieldMap(note.fields, noteType);
    const imageField = rewriteMediaRefs(
      fieldMap.get('Image') ?? '',
      mediaMap,
      mediaBaseUrl
    );
    const occlusion = composeOcclusionSvg(
      imageField,
      parseOcclusionField(fieldMap.get('Occlusion') ?? '')
    );
    const fallback =
      '<div class="apkg-preview-fallback">Image Occlusion cards open with masks in Anki. Download the deck to study them.</div>';
    const masked = occlusion ? sanitizeCardHtml(occlusion) : fallback;
    const deckPath = deck?.name ? deck.name.split('::') : [];
    return {
      id: card.id,
      ord: card.ord,
      templateName: noteType.templates[0]?.name ?? '',
      deckName: deck?.name ?? '',
      deckPath,
      noteTypeName: noteType.name,
      css: sanitizeCss(noteType.css),
      front: masked,
      back: masked,
    };
  }

  private isMcqNoteType(noteType: NoteType): boolean {
    const names = new Set(noteType.fields.map((f) => f.name));
    return names.has('Multiple Choice') && names.has('Correct Answer');
  }

  private renderMcqCard(
    card: { id: number; ord: number },
    note: Note,
    noteType: NoteType,
    deck: { id: number; name: string } | undefined,
    mediaMap: Map<string, string>,
    mediaBaseUrl: string
  ): RenderedCard {
    const fieldMap = buildFieldMap(note.fields, noteType);
    const question = fieldMap.get('Question') ?? '';
    const options = splitMcqField(fieldMap.get('Multiple Choice') ?? '');
    const correctOptions = splitMcqField(fieldMap.get('Correct Answer') ?? '');
    const correctPlainText = new Set(correctOptions.map(mcqPlainText));
    const extra = fieldMap.get('Extra') ?? '';
    const matchedAny = options.some((option) =>
      correctPlainText.has(mcqPlainText(option))
    );

    const renderOptionList = (revealAnswer: boolean): string => {
      const items = options
        .map((option) => {
          const isCorrect =
            revealAnswer && correctPlainText.has(mcqPlainText(option));
          return isCorrect
            ? `<li><mark>✓ <strong>${option}</strong></mark></li>`
            : `<li>${option}</li>`;
        })
        .join('');
      return `<ol class="mcq-options">${items}</ol>`;
    };

    const frontHtml = `<div class="mcq-question">${question}</div>${renderOptionList(false)}`;
    let backHtml = `<div class="mcq-question">${question}</div>${renderOptionList(true)}`;
    if (!matchedAny && correctOptions.length > 0) {
      backHtml += `<div class="mcq-answer-fallback">Correct answer: ${correctOptions.join(', ')}</div>`;
    }
    if (mcqPlainText(extra).length > 0) {
      backHtml += `<div class="mcq-extra">${extra}</div>`;
    }

    const front = rewriteMediaRefs(
      sanitizeCardHtml(frontHtml),
      mediaMap,
      mediaBaseUrl
    );
    const back = rewriteMediaRefs(
      sanitizeCardHtml(backHtml),
      mediaMap,
      mediaBaseUrl
    );
    const deckPath = deck?.name ? deck.name.split('::') : [];
    return {
      id: card.id,
      ord: card.ord,
      templateName: noteType.templates[0]?.name ?? '',
      deckName: deck?.name ?? '',
      deckPath,
      noteTypeName: noteType.name,
      css: sanitizeCss(noteType.css),
      front,
      back,
    };
  }

  private renderCard(
    parsed: ParsedApkg,
    cardId: number,
    mediaBaseUrl: string,
    options: CardRenderOptions
  ): RenderedCard | null {
    const card = parsed.collection.cards.find((c) => c.id === cardId);
    if (!card) {
      console.warn(`[apkg-preview] card ${cardId}: not found in collection`);
      return null;
    }
    const note = parsed.collection.notes.get(card.nid);
    if (!note) {
      console.warn(`[apkg-preview] card ${cardId}: note ${card.nid} not found`);
      return null;
    }
    const noteType = parsed.collection.noteTypes.get(note.mid);
    if (!noteType) {
      console.warn(
        `[apkg-preview] card ${cardId}: noteType ${note.mid} not found`
      );
      return null;
    }
    const templateOrd = noteType.type === 1 ? 0 : card.ord;
    const foundTemplate = noteType.templates.find((t) => t.ord === templateOrd);
    const template = foundTemplate ?? noteType.templates[0];
    if (!template) {
      console.warn(
        `[apkg-preview] card ${cardId}: no templates in noteType "${noteType.name}" — skipping`
      );
      return null;
    }
    if (!foundTemplate) {
      console.debug(
        `[apkg-preview] card ${cardId}: template ord=${templateOrd} not found in noteType "${noteType.name}" (has ${noteType.templates.length} templates) — rendering against ord=0`
      );
    }
    const deck = parsed.collection.decks.get(card.did);

    if (this.isImageOcclusionTemplate(template.qfmt)) {
      return this.renderIoCard(
        card,
        note,
        noteType,
        deck,
        parsed.mediaMap,
        mediaBaseUrl
      );
    }

    if (this.isMcqNoteType(noteType)) {
      return this.renderMcqCard(
        card,
        note,
        noteType,
        deck,
        parsed.mediaMap,
        mediaBaseUrl
      );
    }

    const activeClozeNumber = noteType.type === 1 ? card.ord + 1 : null;
    const frontFields =
      activeClozeNumber != null
        ? applyClozeToFields(note.fields, activeClozeNumber, 'front')
        : note.fields;
    const backFields =
      activeClozeNumber != null
        ? applyClozeToFields(note.fields, activeClozeNumber, 'back')
        : note.fields;

    const baseSpecials: TemplateSpecials = {
      Tags: note.tags.trim(),
      Type: noteType.name,
      Deck: deck?.name ?? '',
      Subdeck: deck?.name.split('::').pop() ?? '',
      Card: template.name,
    };

    const frontRaw = renderTemplate(
      template.qfmt,
      buildFieldMap(frontFields, noteType),
      baseSpecials
    );
    const backRaw = renderTemplate(
      template.afmt,
      buildFieldMap(backFields, noteType),
      { ...baseSpecials, FrontSide: frontRaw }
    );

    const front = rewriteMediaRefs(
      sanitizeCardHtml(frontRaw, options),
      parsed.mediaMap,
      mediaBaseUrl
    );
    const back = rewriteMediaRefs(
      sanitizeCardHtml(backRaw, options),
      parsed.mediaMap,
      mediaBaseUrl
    );
    const css = options.print
      ? [
          noteType.css,
          extractTemplateStyles(template.qfmt),
          extractTemplateStyles(template.afmt),
        ].join('\n')
      : noteType.css;

    const deckPath = deck?.name ? deck.name.split('::') : [];

    return {
      id: card.id,
      ord: card.ord,
      templateName: template.name,
      deckName: deck?.name ?? '',
      deckPath,
      noteTypeName: noteType.name,
      css: sanitizeCss(css),
      front,
      back,
    };
  }
}

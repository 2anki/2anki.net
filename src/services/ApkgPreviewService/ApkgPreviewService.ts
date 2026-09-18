import { composeOcclusionSvg } from './composeOcclusionSvg';
import { extractApkg, parseMediaManifest } from './extractApkg';
import { parseCollection } from './parseCollection';
import { parseOcclusionField } from './parseOcclusionField';
import { applyClozeToFields } from './renderCloze';
import {
  buildFieldMap,
  renderTemplate,
  TemplateSpecials,
} from './renderTemplate';
import { rewriteMediaRefs } from './rewriteMedia';
import { sanitizeCardHtml, sanitizeCss } from './sanitize';
import {
  DeckMeta,
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

export default class ApkgPreviewService {
  private readonly cache = new Map<string, ParsedApkg>();

  async parse(cacheKey: string, bytes: Buffer): Promise<ParsedApkg> {
    const existing = this.cache.get(cacheKey);
    if (existing && Date.now() - existing.parsedAt < CACHE_TTL_MS) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, existing);
      return existing;
    }
    const archive = await extractApkg(bytes);
    const collection = parseCollection(archive.collectionBuffer);
    const mediaMap = parseMediaManifest(archive.mediaManifestRaw);
    const parsed: ParsedApkg = {
      collection,
      mediaMap,
      mediaEntries: archive.mediaEntries,
      parsedAt: Date.now(),
    };
    this.cache.set(cacheKey, parsed);
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
    return parsed;
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
    deckId: number | null = null
  ): { cards: RenderedCard[]; nextCursor: number | null; total: number } {
    const all =
      deckId == null
        ? parsed.collection.cards
        : parsed.collection.cards.filter((card) => card.did === deckId);
    const end = Math.min(all.length, cursor + pageSize);
    const slice = all.slice(cursor, end);
    const cards: RenderedCard[] = [];
    for (const card of slice) {
      const rendered = this.renderCard(parsed, card.id, mediaBaseUrl);
      if (rendered) cards.push(rendered);
    }
    return {
      cards,
      nextCursor: end < all.length ? end : null,
      total: all.length,
    };
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
    mediaBaseUrl: string
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
      sanitizeCardHtml(frontRaw),
      parsed.mediaMap,
      mediaBaseUrl
    );
    const back = rewriteMediaRefs(
      sanitizeCardHtml(backRaw),
      parsed.mediaMap,
      mediaBaseUrl
    );

    const deckPath = deck?.name ? deck.name.split('::') : [];

    return {
      id: card.id,
      ord: card.ord,
      templateName: template.name,
      deckName: deck?.name ?? '',
      deckPath,
      noteTypeName: noteType.name,
      css: sanitizeCss(noteType.css),
      front,
      back,
    };
  }
}

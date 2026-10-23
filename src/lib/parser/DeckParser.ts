import * as cheerio from 'cheerio';
import {
  mergeRescueCandidates,
  type RescueCandidate,
} from '../../types/RescueCandidate';
import type { Element } from 'domhandler';

import preserveNewlinesIfApplicable from '../../services/NotionService/helpers/preserveNewlinesIfApplicable';
import { track } from '../../services/events/track';
import {
  collectIssuedGuids,
  collectRekeyedGuids,
} from '../anki/collectIssuedGuids';
import type { IssuedCardGuid, KnownGuids } from '../anki/guidLedgerTypes';
import {
  hashSourceKey,
  packIdentitySource,
  resolveUploadIdentityGroup,
  uploadIdentityKey,
  type UploadIdentityLedger,
} from '../anki/uploadCardIdentity';
import sanitizeTags from '../anki/sanitizeTags';
import { cardFingerprint } from '../claude/ClaudeService';
import type { CrossFileDedupState } from '../claude/ClaudeService';
import { File } from '../zip/zip';
import Deck from './Deck';
import { toPlainTextBack } from './toPlainTextBack';
import { runSequentially } from './runSequentially';
import Note from './Note';
import { countEmptyBacks } from './countEmptyBacks';
import { truncateDecksToCardLimit } from './truncateDecksToCardLimit';
import { isTypableAnswer, typableAnswerText } from './isTypableAnswer';
import { noteHasAnswerSide } from './noteHasAnswerSide';
import CardOption from './Settings';
import Workspace from './WorkSpace';
import CustomExporter from './exporters/CustomExporter';
import handleClozeDeletions from './helpers/handleClozeDeletions';
import hasInlineClozeCode from './helpers/hasInlineClozeCode';
import hasClozeMarkup from './helpers/hasClozeMarkup';
import handleOverlappingCloze, {
  OverlappingClozeStyle,
} from './helpers/handleOverlappingCloze';
import extractListItems from './helpers/extractListItems';
import extractTextLines from './helpers/extractTextLines';
import splitParagraphSegments from './helpers/splitParagraphSegments';
import { stripLeadingDeckNumbering } from './helpers/stripLeadingDeckNumbering';
import {
  extractHeadingFromSummary,
  extractHeadingMarkup,
} from './helpers/extractHeadingFromSummary';
import replaceAll from './helpers/replaceAll';

import get16DigitRandomId from '../../shared/helpers/get16DigitRandomId';
import { isValidAudioFile } from '../anki/format';
import FallbackParser from './experimental/FallbackParser';
import { embedFile } from './exporters/embedFile';
import { extractDataUriImages } from './extractDataUriImages';
import {
  resolveNotionS3ImageFromZip,
  isNotionSignedFileUrl,
} from './exporters/resolveNotionS3ImageFromZip';
import { recoverNotionExportImageFromZip } from './exporters/recoverNotionExportImageFromZip';
import { downloadMediaOrSkip } from '../../services/NotionService/helpers/downloadMediaOrSkip';
import getUniqueFileName from '../misc/getUniqueFileName';
import getYouTubeEmbedLink from './helpers/getYouTubeEmbedLink';
import getYouTubeID from './helpers/getYouTubeID';
import { isFileNameEqual } from '../storage/types';
import {
  isHTMLFile,
  isImageFileEmbedable,
  isMarkdownFile,
  isPlainText,
} from '../storage/checks';
import { getFileContents } from './getFileContents';
import { normalizeNotionEquations } from './normalizeNotionEquations';
import { unwrapNotionDefaultHighlights } from './unwrapNotionDefaultHighlights';
import { handleNestedBulletPointsInMarkdown } from './handleNestedBulletPointsInMarkdown';
import {
  guessMarkdownCards,
  MarkdownHeuristicResult,
} from './guessMarkdownCards';
import { getTitleFromMarkdown } from './getTitleFromMarkdown';
import { buildDeckStyle } from './buildDeckStyle';
import { highlightCode } from '../notion-render/highlightCode';
import { transformDetailsTagToNotionToggleList } from './transformDetailsTagToNotionToggleList';
import { findNotionToggleLists, isMCQ } from './findNotionToggleLists';
import {
  ancestorSectionTags,
  collectAndStripSectionMarkers,
} from './collectSectionTags';
import {
  EmptyDeckError,
  EmptyDeckReason,
} from '../../usecases/jobs/EmptyDeckError';
import { extractName } from '../extractDeckName';
import {
  InducedRescue,
  InducedRule,
  mergeInducedRescue,
} from './induction/candidateRules';
import { runInduction } from './induction/rankCandidates';
import { clearsQualityFloorExceptCount } from './induction/qualityFloor';
import { scoreCandidateDeck } from './scoreCandidateDeck';
import {
  domPlainTextLength,
  hasDominantTable,
  induceCardsFromDom,
  OFFER_ONLY_RULES,
  UPLOAD_CANDIDATE_RULES,
} from './induction/induceCardsFromDom';

const MARKDOWN_SOURCE_RATIO_THRESHOLD = 0.8;

function isMarkdownSourcedFiles(files: File[]): boolean {
  const contentFiles = files.filter(
    (f) => isMarkdownFile(f.name) || isHTMLFile(f.name)
  );
  if (contentFiles.length === 0) return false;
  const mdCount = contentFiles.filter((f) => isMarkdownFile(f.name)).length;
  return mdCount / contentFiles.length >= MARKDOWN_SOURCE_RATIO_THRESHOLD;
}

export interface DeckParserInput {
  name: string;
  settings: CardOption;
  files: File[];
  noLimits: boolean;
  workspace: Workspace;
  onProgress?: (step: string) => void;
  pdfCredential?: string;
  userId?: number | null;
  anonymousPassId?: number | null;
  requestId?: string;
  knownGuids?: KnownGuids;
  uploadIdentity?: UploadIdentityContext;
  crossFileDedup?: CrossFileDedupState;
  cardLimit?: number;
}

// Present only for signed-in uploads of a format whose fronts are stable
// (markdown, plain HTML, CSV, xlsx). Its absence is the safe default: every
// other conversion is byte-identical to today.
export interface UploadIdentityContext {
  owner: number;
  ledger: UploadIdentityLedger;
}

export interface UploadIdentityStats {
  issued: number;
  replayed: number;
  guarded: number;
}

function hasNestedBullets(content: string | undefined): boolean {
  if (content == null || content === '') return false;
  return /^[ \t]+[-*+][ \t]/m.test(content);
}

function remoteImageExtension(url: string): string {
  const cleaned = url.split('?')[0];
  const match = /\.([a-zA-Z0-9]{1,5})$/.exec(cleaned);
  if (match == null) return 'png';
  return match[1].toLowerCase();
}

function remoteImageFilename(url: string, bytes: Buffer): string {
  return `${getUniqueFileName(bytes.toString('binary'))}.${remoteImageExtension(url)}`;
}

const PARENT_CONTEXT_MAX_CHARS = 200;
const PARENT_CONTEXT_STYLE = 'font-size:0.8em;opacity:0.6;margin-bottom:0.35em';
const PARENT_CONTEXT_MARKER = 'class="parent-context"';

function collapseContextWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function escapeContextText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function bulletOwnText(li: cheerio.Cheerio<Element>): string {
  const clone = li.clone();
  clone.find('ul, ol, details').remove();
  return collapseContextWhitespace(clone.text());
}

const MEDIA_IN_BODY = /<(img|audio|video|figure|embed)\b/i;

function bodyHasContent(body: string): boolean {
  return MEDIA_IN_BODY.test(body) || body.replace(/<[^>]*>/g, '').trim() !== '';
}

const OFFER_ONLY_MIN_CARDS = 3;

export class DeckParser {
  firstDeckName: string;

  settings: CardOption;

  payload: Deck[];

  files: File[];

  noLimits: boolean;

  usedHeuristic: boolean;

  droppedImageCount: number;

  droppedAudioCount: number;

  expiredNotionImageCount: number;

  missingLocalImageCount: number;

  plainTextFallbackImageCount: number;

  emptyBackCount: number;

  // Basic-mode cards that carry {{cN::…}} markup; Anki renders the braces
  // literally, so the conversion report warns and offers cloze mode (#4402).
  strayClozeCount: number;

  private recognizedCardStructureCount: number;

  private cardsRemovedByUserFilter: number;

  private meaningfulTextSeen: boolean;

  private readonly knownGuids?: KnownGuids;

  private readonly ownerUserId: number | null;

  private parentContextEventEmitted = false;

  private readonly uploadIdentity?: UploadIdentityContext;

  private readonly uploadSourceKeyHash: string;

  issuedGuidEntries: IssuedCardGuid[] = [];

  uploadIdentityEntries: IssuedCardGuid[] = [];

  uploadIdentityStats: UploadIdentityStats = {
    issued: 0,
    replayed: 0,
    guarded: 0,
  };

  inducedRule?: InducedRescue;

  // Structures that produced cards but failed the quality floor, summed across
  // sub-decks; offered on the empty-deck state so the user can pick one.
  rescueCandidates: RescueCandidate[] = [];

  private sawUnclassifiedParse: boolean;

  private readonly cardLimit?: number;

  cardsHeldBack = 0;

  workspace: Workspace;
  customExporter: CustomExporter;

  public get name() {
    return this.payload[0]?.name ?? this.firstDeckName;
  }

  parsePathSignature(): string {
    return this.sawUnclassifiedParse ? 'unclassified' : 'recognized';
  }

  constructor(input: DeckParserInput) {
    this.settings = input.settings;
    this.files = input.files || [];
    this.knownGuids = input.knownGuids;
    this.ownerUserId = input.userId ?? null;
    this.uploadIdentity = input.uploadIdentity;
    this.uploadSourceKeyHash = hashSourceKey(input.name);
    this.firstDeckName = input.name;
    this.noLimits = input.noLimits;
    this.usedHeuristic = false;
    this.droppedImageCount = 0;
    this.droppedAudioCount = 0;
    this.expiredNotionImageCount = 0;
    this.missingLocalImageCount = 0;
    this.plainTextFallbackImageCount = 0;
    this.emptyBackCount = 0;
    this.strayClozeCount = 0;
    this.recognizedCardStructureCount = 0;
    this.cardsRemovedByUserFilter = 0;
    this.meaningfulTextSeen = false;
    this.sawUnclassifiedParse = false;
    this.cardLimit = input.cardLimit;
    this.payload = [];
    this.workspace = input.workspace ?? new Workspace(true, 'fs');
    this.customExporter = new CustomExporter(
      input.name,
      this.workspace.location
    );
    this.processFirstFile(input.name);
  }

  processFirstFile(name: string) {
    const firstFile = this.files.find((file) => isFileNameEqual(file, name));

    if (isMarkdownFile(name)) {
      const contents = getFileContents(firstFile, false);
      const contentsStr = contents?.toString();
      if (!this.meaningfulTextSeen && (contentsStr?.trim().length ?? 0) > 0) {
        this.meaningfulTextSeen = true;
      }
      if (this.settings.nestedBulletPoints || hasNestedBullets(contentsStr)) {
        this.payload = handleNestedBulletPointsInMarkdown({
          name,
          contents: contentsStr,
          deckName: this.settings.deckName,
          decks: [],
          settings: this.settings,
          exporter: this.customExporter,
          workspace: this.workspace,
          files: this.files,
        });
      }
      if (this.payload.every((d) => d.cards.length === 0)) {
        const heuristic = guessMarkdownCards(contentsStr ?? '');
        if (heuristic) {
          this.applyHeuristic(heuristic, contentsStr, name);
        }
      }
    } else if (isHTMLFile(name)) {
      const contents = getFileContents(firstFile, true);
      this.payload = contents
        ? this.handleHTML(
            name,
            contents.toString(),
            this.settings.deckName || '',
            []
          )
        : [];
    } else {
      // A plain-text file carries real content even when the fallback parser
      // finds no question/answer structure in it, so record the text here.
      // Otherwise an empty .txt deck reports no_content (nothing to read) when
      // the honest reason is no_toggles (text, but no card shape).
      if (!this.meaningfulTextSeen && isPlainText(name)) {
        const contents = getFileContents(firstFile, false);
        if ((contents?.toString().trim().length ?? 0) > 0) {
          this.meaningfulTextSeen = true;
        }
      }
      this.payload = [];
    }
  }

  findNextPage(href: string | undefined): string | Uint8Array | undefined {
    if (!href) {
      console.debug(`skipping next page, due to href being ${href}`);
      return undefined;
    }
    const next = global.decodeURIComponent(href);
    const nextFile = this.files.find((file) =>
      file.name.match(next.replace(/[#-.]|[[-^]|[?|{}]/g, '\\$&'))
    );
    return nextFile?.contents?.toString();
  }

  noteHasCherry(note: Note) {
    const cherry = '&#x1F352;';
    return (
      note.name.includes(cherry) ||
      note.back.includes(cherry) ||
      note.name.includes('🍒') ||
      note.back.includes('🍒')
    );
  }

  noteHasAvocado(note: Note) {
    const avocado = '&#x1F951;';
    return (
      note.name.includes(avocado) ||
      note.back.includes(avocado) ||
      note.name.includes('🥑') ||
      note.back.includes('🥑')
    );
  }

  findIndentedToggleLists(dom: cheerio.CheerioAPI): Element[] {
    const selector = '.page-body > details';
    return dom(selector).toArray();
  }

  // A Notion toggleable heading exports as a bare <details> directly under
  // .page-body — regular toggles are normalised to ul.toggle before this runs,
  // so a leftover bare details is always a heading. When such a heading wraps
  // ONLY toggles (directly or through sub-headings) it is a section, not a card:
  // each nested toggle is promoted to the page body so it becomes its own card,
  // similar to the Notion API path (#3950). The fold boundary is ul.toggle only,
  // so a toggle nested inside a regular toggle stays folded into its parent
  // (#3515) while a toggle nested inside a sub-heading is still promoted.
  //
  // All-or-nothing per page (#4877): the expansion only runs when EVERY
  // .page-body > details heading on the page qualifies. If any one bails — plain
  // content, non-toggle content beside the toggles, a cherry/cloze summary, or
  // no toggles at all — the whole page is left untouched, byte-identical to not
  // running this pass. Expanding one heading promotes a ul.toggle into the page
  // body, which makes extractToggleLists skip transformDetailsTagToNotionToggleList;
  // a different plain heading would then come through findIndentedToggleLists
  // only, and in the new display:contents shape its flattened body is empty, so
  // its card would be silently dropped (and in the old shape its markup would
  // change, breaking content-GUID dedup). Cherry mode is skipped wholesale: its
  // descendant toggles already become distinct cards, so the collapse never
  // happens there.
  private expandToggleHeadingSections(dom: cheerio.CheerioAPI): void {
    if (this.settings.isCherry) {
      return;
    }
    const headings = dom('.page-body > details').toArray();
    if (headings.length === 0) {
      return;
    }
    const plans: { heading: Element; toggles: Element[] }[] = [];
    for (const heading of headings) {
      const toggles = this.planToggleHeadingExpansion(dom, heading);
      if (toggles == null) {
        return;
      }
      plans.push({ heading, toggles });
    }
    for (const { heading, toggles } of plans) {
      const promoted = toggles.map((toggle) => dom.html(toggle)).join('');
      dom(heading).replaceWith(promoted);
    }
  }

  // Returns the outermost toggles to promote, or null when the heading must keep
  // its single card (see expandToggleHeadingSections).
  private planToggleHeadingExpansion(
    dom: cheerio.CheerioAPI,
    heading: Element
  ): Element[] | null {
    const summaryHTML = dom(heading).children('summary').first().html() ?? '';
    if (this.headingSummaryOptsOutOfExpansion(summaryHTML)) {
      return null;
    }
    const toggles = dom(heading)
      .find('ul.toggle')
      .toArray()
      .filter(
        (toggle) =>
          dom(toggle).parentsUntil(heading).filter('ul.toggle').length === 0
      );
    if (toggles.length === 0) {
      return null;
    }
    if (!this.toggleHeadingHoldsOnlyToggles(dom, heading)) {
      return null;
    }
    return toggles;
  }

  private headingSummaryOptsOutOfExpansion(summaryHTML: string): boolean {
    if (summaryHTML.includes('&#x1F352;') || summaryHTML.includes('🍒')) {
      return true;
    }
    return hasClozeMarkup(summaryHTML) || hasInlineClozeCode(summaryHTML);
  }

  // True only when the heading's body is nothing but toggles (and sub-heading
  // wrappers around toggles). From a clone, every summary (the heading's own and
  // any sub-heading titles) and every ul.toggle is removed; the heading holds
  // only toggles when no visible text and no element other than a bare wrapper
  // (details / div / p / br) remains. A denylist, not a media allowlist, so any
  // other content — an image, table, callout, hr, link, equation, bullet list, a
  // plain heading — keeps the heading as a single card rather than dropping it.
  private static readonly TOGGLE_HEADING_WRAPPER_TAGS = new Set([
    'details',
    'div',
    'p',
    'br',
  ]);

  private toggleHeadingHoldsOnlyToggles(
    dom: cheerio.CheerioAPI,
    heading: Element
  ): boolean {
    const body = dom(heading).clone();
    body.find('summary').remove();
    body.find('ul.toggle').remove();
    if (body.text().replace(/\s+/g, '').length > 0) {
      return false;
    }
    let onlyWrappers = true;
    body.find('*').each((_i, element) => {
      const tag = element.tagName?.toLowerCase();
      if (tag == null || !DeckParser.TOGGLE_HEADING_WRAPPER_TAGS.has(tag)) {
        onlyWrappers = false;
        return false;
      }
      return undefined;
    });
    return onlyWrappers;
  }

  removeNestedTogglesLegacy(input: string): string {
    return input
      .replace(/<details[^>]*>([\s\S]*?)<\/details>/g, (_match, inner) =>
        extractHeadingFromSummary(inner)
      )
      .replace(/<summary[^>]*>([\s\S]*?)<\/summary>/g, (_match, inner) =>
        extractHeadingMarkup(inner)
      )
      .replace(/<li><\/li>/g, '')
      .replace(/<ul[^/>][^>]*><\/ul>/g, '')
      .replace(/<\/details><\/li><\/ul><\/details><\/li><\/ul>/g, '')
      .replace(/<\/details><\/li><\/ul>/g, '')
      .replaceAll('<summary class="toggle"></summary>', '');
  }

  removeNestedTogglesNewFormat(input: string): string {
    const result = this.cleanupEmptyElements(input, true);
    return result.trim();
  }

  private applyHeuristic(
    heuristic: MarkdownHeuristicResult,
    contentsStr: string | undefined,
    name: string
  ) {
    for (const note of heuristic.notes) {
      if (this.settings.embedImages) {
        const { html: newName, media: namMedia } = this.embedImagesInHtml(
          note.name
        );
        const { html: newBack, media: backMedia } = this.embedImagesInHtml(
          note.back
        );
        note.name = newName;
        note.back = newBack;
        note.media = [...namMedia, ...backMedia];
      } else {
        note.media = [];
      }
    }
    const deck = new Deck(
      this.settings.deckName ??
        this.applyDeckNameNumbering(getTitleFromMarkdown(contentsStr) ?? name),
      heuristic.notes,
      '',
      buildDeckStyle(this.settings),
      get16DigitRandomId(),
      this.settings
    );
    this.payload = [deck];
    this.usedHeuristic = true;
  }

  private embedImagesInHtml(html: string): { html: string; media: string[] } {
    // Fragment mode (isDocument=false). xmlMode would double-escape `&nbsp;`
    // (and other named HTML entities) because xmlMode treats them as
    // undefined-in-XML and re-escapes the `&`, producing visible `&nbsp;`
    // text in the user's card. Default doc mode would wrap output in
    // <html><body>...
    const dom = cheerio.load(html, null, false);
    const media: string[] = [];
    dom('img').each((_i, elem) => {
      const src = dom(elem).attr('src');
      if (!src) return;

      if (isImageFileEmbedable(src)) {
        const newName = embedFile({
          exporter: this.customExporter,
          files: this.files,
          filePath: decodeURIComponent(src),
          workspace: this.workspace,
        });
        if (newName) {
          dom(elem).attr('src', newName);
          media.push(newName);
        }
        return;
      }

      const zipFile = resolveNotionS3ImageFromZip(src, this.files);
      if (zipFile) {
        const newName = embedFile({
          exporter: this.customExporter,
          files: this.files,
          filePath: zipFile.name,
          workspace: this.workspace,
        });
        if (newName) {
          dom(elem).attr('src', newName);
          media.push(newName);
        }
      }
    });
    return { html: dom.html() ?? html, media };
  }

  private cleanupEmptyElements(
    html: string,
    isNewFormat: boolean = false
  ): string {
    let result = html.replace(/<li><\/li>/g, '');

    if (isNewFormat) {
      result = result.replace(
        /<summary[^>]*class="toggle"[^>]*><\/summary>/g,
        ''
      );
      result = result.replace(/<summary[^>]*><\/summary>/g, '');
      result = result.replaceAll('<summary class="toggle"></summary>', '');
    } else {
      result = result.replaceAll('<summary class="toggle"></summary>', '');
    }

    return result;
  }

  getLink(pageId: string | undefined, note: Note): string | null {
    try {
      const page = pageId!.replace(/-/g, '');
      const link = `https://www.notion.so/${page}#${note.notionId}`;
      return `
                <a
                style="text-decoration: none; color: grey;"
                href="${link}">
                  Open in Notion
                </a>
                `;
    } catch (error) {
      console.info('experienced error while getting link');
      console.error(error);
      return null;
    }
  }

  // Avoids a full cheerio.load on the whole document. Paired with loadDOM,
  // a DOM-based normalisation here meant the entire HTML was materialised as a
  // cheerio tree twice in a row, which OOM'd 30–40 MB Notion exports.
  removeNewlinesInSVGPathAttributeD(html: string): string {
    return html.replace(
      /<path\b([^>]*?)\sd=(["'])([\s\S]*?)\2/gi,
      (_match, prefix, quote, value) =>
        `<path${prefix} d=${quote}${value.replace(/\n/g, '').trim()}${quote}`
    );
  }

  getFirstHeadingText(dom: cheerio.CheerioAPI) {
    try {
      const firstHeading = dom('h1').first();
      return firstHeading.text();
    } catch (e) {
      console.error(e);
      return undefined;
    }
  }

  private applyDeckNameNumbering(name: string): string {
    return this.settings.removeDeckNameNumbering
      ? stripLeadingDeckNumbering(name)
      : name;
  }

  handleHTML(
    fileName: string,
    contents: string,
    deckName: string,
    decks: Deck[],
    inheritedGlobalTags: string[] = []
  ) {
    const { dom, isNewFormat } = this.loadAndNormalizeDOM(
      this.unpackDataUriImages(contents)
    );

    const style = buildDeckStyle(this.settings);
    let image: string | undefined = this.extractCoverImage(dom);

    const name = extractName({
      name:
        deckName ||
        this.applyDeckNameNumbering(dom('title').text()) ||
        this.applyDeckNameNumbering(this.getFirstHeadingText(dom) ?? '') ||
        this.applyDeckNameNumbering(fileName) ||
        'Default',
      pageIcon: this.extractPageIcon(dom),
      decksCount: decks.length,
      settings: this.settings,
    });

    const fileGlobalTags = [
      ...new Set([...inheritedGlobalTags, ...this.extractGlobalTags(dom)]),
    ];

    const toggleList = this.extractToggleLists(dom);
    const paragraphs = this.extractCardsFromParagraph(dom);
    const extractResult = this.extractCards(dom, toggleList, isNewFormat);
    let cards: Note[] = extractResult.cards;

    const disableIndentedBullets = this.settings.disableIndentedBulletPoints;
    if (cards.length === 0) {
      // Only the zero-card branch feeds the empty-deck reason, so the page-text
      // measurement stays off the hot path for conversions that produced cards.
      if (!this.meaningfulTextSeen && domPlainTextLength(dom) > 0) {
        this.meaningfulTextSeen = true;
      }
      const tableNotes = this.induceDominantTableCards(dom);
      const overlappingPageNotes =
        tableNotes != null ? [] : this.buildPageListOverlappingNotes(dom);
      const overlappingParagraphNotes =
        tableNotes != null || overlappingPageNotes.length > 0
          ? []
          : this.buildPageParagraphOverlappingNotes(dom);
      const overlappingLineNotes =
        tableNotes != null ||
        overlappingPageNotes.length > 0 ||
        overlappingParagraphNotes.length > 0
          ? []
          : this.buildPageLinesOverlappingNotes(dom);
      if (tableNotes != null) {
        cards.push(...tableNotes);
      } else if (overlappingPageNotes.length > 0) {
        cards.push(...overlappingPageNotes);
      } else if (overlappingParagraphNotes.length > 0) {
        cards.push(...overlappingParagraphNotes);
      } else if (overlappingLineNotes.length > 0) {
        cards.push(...overlappingLineNotes);
      } else {
        this.sawUnclassifiedParse = true;
        const unclassified = [
          ...this.extractCardsFromLists(dom, disableIndentedBullets),
          ...paragraphs,
        ].filter((note) => this.unclassifiedCardSurvives(note));
        cards.push(...unclassified);
      }
    } else if (this.settings.disableIndentedBulletPoints) {
      cards.push(
        ...[...this.extractCardsFromLists(dom, disableIndentedBullets)]
      );
    }

    cards = cards.filter(Boolean);

    // Gate on what survives cleaning, not the raw count: a parse that produced
    // only cards Deck.CleanCards will strip (an empty-toggle equivalent) is
    // effectively empty, so it must reach the rescue instead of shipping an
    // empty deck. hasSalvageableCards also treats raw-stage cloze notes (their
    // cloze flag not yet set) as usable, so a healthy cloze deck is never
    // rescued. The rescued set replaces the unusable cards outright.
    if (!this.hasSalvageableCards(cards)) {
      const rescued = this.induceCardsFromStructure(dom);
      if (rescued != null) {
        cards = rescued;
      }
    } else if (this.isDegenerateYield(cards, dom)) {
      const richer = this.induceRicherDeck(cards, dom);
      if (richer != null) {
        cards = richer;
      }
    }

    const deck = new Deck(
      name,
      cards,
      image,
      style,
      get16DigitRandomId(),
      this.settings
    );
    deck.globalTags = fileGlobalTags;
    deck.mcqCount = extractResult.mcqCount;
    deck.mcqSkippedCount = extractResult.mcqSkippedCount;
    decks.push(deck);

    const subpages = dom('.link-to-page').toArray();
    for (const page of subpages) {
      const spDom = dom(page);
      const ref = spDom.find('a').first();
      const href = ref.attr('href');
      const pageContent = this.findNextPage(href);
      if (pageContent && name) {
        const subDeckName = this.applyDeckNameNumbering(
          this.subPageName(spDom, ref)
        );
        this.handleHTML(
          fileName,
          pageContent.toString(),
          `${name}::${subDeckName}`,
          decks,
          fileGlobalTags
        );
      }
    }
    return decks;
  }

  // A deck is salvageable if any card survives cleaning or carries an explicit
  // {{c…}} cloze, and — when cloze mode is on — if any card holds an inline
  // <code> span, which processPayload turns into a cloze deletion. Without the
  // <code> case a page whose only cloze uses the code shorthand would look
  // empty and get mangled by induction.
  private hasSalvageableCards(cards: Note[]): boolean {
    if (Deck.hasUsableCards(cards)) {
      return true;
    }
    return (
      this.settings.isCloze &&
      cards.some(
        (card) => hasInlineClozeCode(card.name) || hasInlineClozeCode(card.back)
      )
    );
  }

  // A recognized-but-tiny deck from a large document is the silent version of
  // the empty-deck failure: two toggles found in half a megabyte of text ships
  // as "success" while the substance of the file never becomes cards. The
  // thresholds are deliberately conservative — at most 2 usable cards, and at
  // least 20k characters of document text — so a deliberate two-card page on a
  // normal-sized document is never second-guessed.
  private isDegenerateYield(cards: Note[], dom: cheerio.CheerioAPI): boolean {
    const DEGENERATE_MAX_USABLE_CARDS = 2;
    const DEGENERATE_MIN_DOC_CHARS = 20_000;
    return (
      Deck.CleanCards([...cards]).length <= DEGENERATE_MAX_USABLE_CARDS &&
      domPlainTextLength(dom) >= DEGENERATE_MIN_DOC_CHARS
    );
  }

  // Same candidate loop as the empty-deck rescue, but the bar is higher: the
  // winning candidate must beat the score of the deck the parse already
  // produced, not just clear the quality floor. Losing to the existing cards
  // records rescue_rejected so the corpus keeps the attempt.
  private induceRicherDeck(
    existing: Note[],
    dom: cheerio.CheerioAPI
  ): Note[] | null {
    const rules = this.uploadCandidateRules();
    if (rules.length === 0) {
      return null;
    }
    const docChars = domPlainTextLength(dom);
    const { winner } = runInduction(
      rules,
      (rule) => induceCardsFromDom(dom, rule),
      docChars
    );
    if (winner == null) {
      return null;
    }
    const existingScore = scoreCandidateDeck(existing, docChars);
    if (winner.score.score <= existingScore.score) {
      this.recordInducedRule({
        rule: winner.rule,
        outcome: 'rescue_rejected',
        score: winner.score,
      });
      return null;
    }
    this.recordInducedRule({
      rule: winner.rule,
      outcome: 'rescue_shipped',
      score: winner.score,
    });
    return winner.cards;
  }

  // The user picked a structure on the empty-deck state after seeing the
  // counts, so the quality floor steps aside: a deck they chose with their
  // eyes open beats an honest empty one. Only consulted once no candidate
  // cleared the floor on its own, so a forged field can never replace a deck
  // the floor would have accepted, and never on a page that makes cards.
  private induceChosenRule(
    dom: cheerio.CheerioAPI,
    rules: InducedRule[]
  ): Note[] | null {
    const rule = this.settings.rescueRule;
    if (rule == null || !rules.includes(rule)) {
      return null;
    }
    const cards = induceCardsFromDom(dom, rule);
    if (cards.length === 0) {
      return null;
    }
    this.recordInducedRule({
      rule,
      outcome: 'rescue_chosen',
      score: scoreCandidateDeck(cards, domPlainTextLength(dom)),
    });
    return cards;
  }

  private uploadCandidateRules(): InducedRule[] {
    // clozeFromToggleContent assumes a toggle front; isCherry means the user
    // explicitly restricted the conversion to selected blocks, so inducing a
    // whole-document deck would silently override that filter. Both skip
    // induction and fail honest.
    if (this.settings.clozeFromToggleContent || this.settings.isCherry) {
      return [];
    }
    const rules = [...UPLOAD_CANDIDATE_RULES];
    if (this.settings.template === 'hierarchy') {
      return rules.filter((rule) => rule !== 'heading');
    }
    return rules;
  }

  // Runs first when the normal HTML parse produced zero cards. A document whose
  // body is one dominant table is a deliberate two-column layout — its rows are
  // the card boundary the author drew — so it routes straight to the columns
  // rule, ahead of the per-bullet fan-out and exempt from FLOOR_MIN_CARDS only:
  // a two-row Q/A table must ship two row cards, not six bullet fragments
  // (#4366). The rest of the quality floor still applies — a dominant table of
  // repeated fronts or blank backs fails honest exactly as before. Anything short of the dominance predicate falls through
  // to the existing pipeline unchanged.
  private induceDominantTableCards(dom: cheerio.CheerioAPI): Note[] | null {
    if (this.uploadCandidateRules().length === 0) {
      return null;
    }
    if (!hasDominantTable(dom)) {
      return null;
    }
    const notes = induceCardsFromDom(dom, 'columns');
    if (notes.length < 2) {
      return null;
    }
    const score = scoreCandidateDeck(notes, domPlainTextLength(dom));
    if (!clearsQualityFloorExceptCount(notes, score)) {
      return null;
    }
    this.recordInducedRule({
      rule: 'columns',
      outcome: 'rescue_shipped',
      score,
    });
    return notes;
  }

  // Runs only when the normal HTML parse produced zero cards. It re-derives the
  // card boundary from the document's own structure (headings, nested lists,
  // two-column tables, blockquotes, Q:/A: and term::definition markers) on the
  // DOM before the plain-text flattening fallback, so bold, highlight and colour
  // survive. Each candidate is scored; the best that clears the quality floor
  // ships, or we leave the deck empty and fail honest.
  private induceCardsFromStructure(dom: cheerio.CheerioAPI): Note[] | null {
    const rules = this.uploadCandidateRules();
    if (rules.length === 0) {
      return null;
    }
    const { winner, best, candidates } = runInduction(
      rules,
      (rule) => induceCardsFromDom(dom, rule),
      domPlainTextLength(dom)
    );
    if (winner == null) {
      const offered = [...rules, ...OFFER_ONLY_RULES];
      const chosen = this.induceChosenRule(dom, offered);
      if (chosen != null) {
        return chosen;
      }
      if (best != null) {
        this.recordInducedRule({
          rule: best.rule,
          outcome: 'rescue_rejected',
          score: best.score,
        });
      }
      this.rescueCandidates = mergeRescueCandidates([
        this.rescueCandidates,
        candidates,
        this.offerOnlyCandidates(dom),
      ]);
      return null;
    }
    this.recordInducedRule({
      rule: winner.rule,
      outcome: 'rescue_shipped',
      score: winner.score,
    });
    return winner.cards;
  }

  private offerOnlyCandidates(dom: cheerio.CheerioAPI): RescueCandidate[] {
    return OFFER_ONLY_RULES.map((rule) => ({
      rule,
      cards: induceCardsFromDom(dom, rule).length,
    })).filter(({ cards }) => cards >= OFFER_ONLY_MIN_CARDS);
  }

  private recordInducedRule(next: InducedRescue): void {
    this.inducedRule = mergeInducedRescue(this.inducedRule, next);
  }

  private extractGlobalTags(dom: cheerio.CheerioAPI): string[] {
    const tags: string[] = [];
    dom('.page-body > p > del').each((_i: number, elem: Element) => {
      tags.push(...sanitizeTags(dom(elem).text().split(',')));
    });
    return tags;
  }

  // https://stackoverflow.com/questions/6903823/regex-for-youtube-id
  _getYouTubeID(input: string) {
    return this.ensureNotNull(input, () => {
      try {
        return getYouTubeID(input);
      } catch (error) {
        console.debug('error in getYouTubeID');
        console.error(error);
        return null;
      }
    });
  }

  ensureNotNull(input: string, cb: () => void) {
    if (!input || !input.trim()) {
      return null;
    }
    return cb();
  }

  getSoundCloudURL(input: string) {
    return this.ensureNotNull(input, () => {
      try {
        const sre = /https?:\/\/soundcloud\.com\/\S*/gi;
        const m = input.match(sre);
        if (!m || m.length === 0) {
          return null;
        }
        return m[0].split('">')[0];
      } catch (error) {
        console.debug('error in getSoundCloudURL');
        console.error(error);
        return null;
      }
    });
  }

  treatBoldAsInput(input: string, inline: boolean) {
    const dom = cheerio.load(input);
    const underlines = dom('strong');
    let mangle = input;
    let answer = '';
    underlines.each((_i, elem) => {
      const v = dom(elem).html();
      // The typed-answer comparison needs plain text: a bold span that also
      // carries nested formatting (an italic word, an inline color span)
      // has innerHTML like "mito<em>chondrion</em>", which never matches
      // whatever the user actually types. Trimmed .text() also skips a
      // whitespace-only bold span, which innerHTML alone treats as an
      // answer.
      const text = dom(elem).text().trim();
      if (v && text) {
        const old = `<strong>${v}</strong>`;
        mangle = replaceAll(mangle, old, inline ? v : '{{type:Input}}');
        answer = text;
      }
    });
    return { mangle, answer };
  }

  locateTags(card: Note, deckGlobalTags: string[]) {
    const input = [card.name, card.back];

    if (!card.tags) {
      card.tags = [];
    }

    for (const i of input) {
      if (!i) {
        continue;
      }

      if (!i.includes('<del')) {
        continue;
      }

      const dom = cheerio.load(i);
      const deletionsDOM = dom('del');
      deletionsDOM.each((_i: number, elem: Element) => {
        const del = dom(elem);
        card.tags.push(...sanitizeTags(del.text().split(',')));
        card.back = replaceAll(card.back, `<del>${del.html()}</del>`, '');
        card.name = replaceAll(card.name, `<del>${del.html()}</del>`, '');
      });
    }

    for (const sectionTag of card.sectionTags) {
      if (!card.tags.includes(sectionTag)) {
        card.tags.push(sectionTag);
      }
    }

    card.tags.push(...deckGlobalTags);
    return card;
  }

  applyGlobalTags(cards: Note[]) {
    if (this.settings.globalTags.length === 0) {
      return;
    }
    for (const card of cards) {
      if (!card.tags) {
        card.tags = [];
      }
      for (const tag of this.settings.globalTags) {
        if (!card.tags.includes(tag)) {
          card.tags.push(tag);
        }
      }
    }
  }

  private embedLocalOrZipImage(
    dom: cheerio.CheerioAPI,
    elem: Element,
    originalName: string,
    card: Note,
    ws: Workspace
  ): boolean {
    if (isImageFileEmbedable(originalName)) {
      const decodedPath = decodeURIComponent(originalName);
      const newName = embedFile({
        exporter: this.customExporter,
        files: this.files,
        filePath: decodedPath,
        workspace: ws,
        fallbackWorkspaceLocation: this.workspace.location,
      });
      if (newName) {
        dom(elem).attr('src', newName);
        card.media.push(newName);
      } else {
        dom(elem).attr('src', decodedPath.split('/').pop() ?? originalName);
        this.droppedImageCount++;
        this.missingLocalImageCount++;
      }
      return true;
    }

    const zipFile =
      resolveNotionS3ImageFromZip(originalName, this.files) ??
      recoverNotionExportImageFromZip(originalName, this.files);
    if (zipFile) {
      const newName = embedFile({
        exporter: this.customExporter,
        files: this.files,
        filePath: zipFile.name,
        workspace: ws,
        fallbackWorkspaceLocation: this.workspace.location,
      });
      if (newName) {
        dom(elem).attr('src', newName);
        card.media.push(newName);
      } else {
        this.droppedImageCount++;
      }
      return true;
    }

    return false;
  }

  private async embedRemoteImage(
    dom: cheerio.CheerioAPI,
    elem: Element,
    url: string,
    card: Note
  ): Promise<void> {
    let bytes: Buffer | null = null;
    let fetchThrew = false;
    try {
      bytes = await downloadMediaOrSkip(url);
    } catch {
      fetchThrew = true;
      console.warn(`Failed to fetch remote image ${url}`);
    }
    if (bytes == null) {
      this.droppedImageCount++;
      if (!fetchThrew) {
        console.warn(
          'Skipping media fetch for a remote image — fetch returned no content (URL likely expired)'
        );
        if (isNotionSignedFileUrl(url)) {
          this.expiredNotionImageCount++;
        }
      }
      return;
    }

    const newName = remoteImageFilename(url, bytes);
    this.customExporter.addMedia(newName, bytes);
    dom(elem).attr('src', newName);
    card.media.push(newName);
  }

  private async embedImagesInCardContent(
    content: string,
    card: Note,
    ws: Workspace
  ): Promise<string> {
    if (!content.includes('<img')) return content;

    const dom = cheerio.load(content);
    const images = dom('img').toArray();
    if (images.length === 0) return content;

    await runSequentially(images, async (elem) => {
      const originalName = dom(elem).attr('src');
      if (!originalName) return;

      DeckParser.unwrapExportImageLink(dom, elem, originalName);

      const handled = this.embedLocalOrZipImage(
        dom,
        elem,
        originalName,
        card,
        ws
      );
      if (handled) return;

      await this.embedRemoteImage(dom, elem, originalName, card);
    });
    return dom.html();
  }

  private static hrefTargetsImageFile(href: string, imageSrc: string): boolean {
    if (href === imageSrc) return true;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
    if (href.startsWith('//')) return false;
    if (href.startsWith('#')) return false;
    if (isValidAudioFile(href)) return false;
    const pathOnly = href.split(/[?#]/)[0];
    return /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|heic|heif|avif|ico|apng|jfif)$/i.test(
      pathOnly
    );
  }

  private static anchorHoldsOnlyImage(
    anchor: cheerio.Cheerio<Element>,
    elem: Element
  ): boolean {
    const children = anchor.children().toArray();
    if (children.length !== 1) return false;
    if (children[0] !== elem) return false;
    return anchor.text().trim() === '';
  }

  private static unwrapExportImageLink(
    dom: cheerio.CheerioAPI,
    elem: Element,
    imageSrc: string
  ): void {
    const anchor = dom(elem).parent('a');
    if (anchor.length === 0) return;
    const href = anchor.attr('href');
    if (href == null || href === '') return;
    if (!DeckParser.hrefTargetsImageFile(href, imageSrc)) return;
    if (!DeckParser.anchorHoldsOnlyImage(anchor, elem)) return;
    anchor.replaceWith(dom(elem));
  }

  private async embedCardImages(card: Note, ws: Workspace): Promise<void> {
    if (!this.settings.embedImages) {
      return;
    }
    if (card.name) {
      card.name = await this.embedImagesInCardContent(card.name, card, ws);
    }
    if (card.back) {
      card.back = await this.embedImagesInCardContent(card.back, card, ws);
    }
  }

  private static isLocalAudioTarget(
    target: string | undefined
  ): target is string {
    return (
      target != null && !target.startsWith('http') && isValidAudioFile(target)
    );
  }

  private embedCardAudio(card: Note, ws: Workspace) {
    const lower = card.back.toLowerCase();
    if (
      !lower.includes('<a') &&
      !lower.includes('<audio') &&
      !lower.includes('<source')
    ) {
      return;
    }

    const dom = cheerio.load(card.back);
    const resolved = new Map<string, string | null>();
    const embedTarget = (target: string): string | null => {
      let newFileName = resolved.get(target);
      if (newFileName === undefined) {
        newFileName = embedFile({
          exporter: this.customExporter,
          files: this.files,
          filePath: global.decodeURIComponent(target),
          workspace: ws,
          fallbackWorkspaceLocation: this.workspace.location,
        });
        resolved.set(target, newFileName);
      }
      return newFileName;
    };

    dom('a[href]').each((_i, el) => {
      const anchor = dom(el);
      const href = anchor.attr('href');
      if (!DeckParser.isLocalAudioTarget(href)) return;
      if (embedTarget(href) == null) return;
      if (this.settings.removeMP3Links) {
        const figure = anchor.closest('figure');
        if (figure.length > 0) figure.remove();
        else anchor.remove();
      }
    });

    // A left-behind <audio> element points at a path that no longer exists
    // inside the .apkg, so it renders as a dead player; the [sound:] tag
    // below is the working replacement.
    dom('audio[src], source[src]').each((_i, el) => {
      const element = dom(el);
      const src = element.attr('src');
      if (!DeckParser.isLocalAudioTarget(src)) return;
      if (embedTarget(src) == null) return;
      const player = element.closest('audio');
      if (player.length > 0) player.remove();
      else element.remove();
    });

    const resolvedResults = Array.from(resolved.values());
    const droppedAudio = resolvedResults.filter((name) => name == null).length;
    if (droppedAudio > 0) {
      this.droppedAudioCount += droppedAudio;
      console.warn(
        `Skipping ${droppedAudio} local audio file(s) that could not be found in the upload`
      );
    }

    const embedded = Array.from(
      new Set(resolvedResults.filter((name): name is string => name != null))
    );
    if (embedded.length === 0) return;

    let back = dom('body').html() ?? card.back;
    for (const newFileName of embedded) {
      back += `[sound:${newFileName}]`;
      card.media.push(newFileName);
    }
    card.back = back;
  }

  private appendCardVideoEmbeds(card: Note) {
    const id = this._getYouTubeID(card.back);
    if (id) {
      const ytSrc = getYouTubeEmbedLink(id);
      card.back +=
        `<div style='position:relative;width:100%;max-width:560px;margin:0 auto;'>` +
        `<div style='position:relative;padding-bottom:56.25%;height:0;'>` +
        `<iframe src='${ytSrc}' style='position:absolute;top:0;left:0;width:100%;height:100%;border:0;' allowfullscreen></iframe>` +
        `</div></div>`;
    }

    const soundCloudUrl = this.getSoundCloudURL(card.back);
    if (soundCloudUrl) {
      card.back += `<iframe width='100%' height='166' scrolling='no' frameborder='no' src='https://w.soundcloud.com/player/?url=${soundCloudUrl}'></iframe>`;
    }
  }

  private noteStrayClozeMarkup(card: Note): void {
    if (card.cloze) return;
    if (hasClozeMarkup(card.name) || hasClozeMarkup(card.back)) {
      this.strayClozeCount += 1;
    }
  }

  // A bold span with no text (or a mismatched replace) leaves answer empty
  // — only flip to the input note type when there's an actual word to type,
  // so an unmatched **bold** never ships as an Input card with nothing to
  // compare the typed answer against.
  private applyInputAnswer(card: Note): void {
    if (!this.settings.useInput) return;
    if (card.name.includes('<strong>')) {
      const inputInfo = this.treatBoldAsInput(card.name, false);
      if (!inputInfo.answer) return;
      card.name = inputInfo.mangle;
      card.answer = inputInfo.answer;
      card.enableInput = true;
      return;
    }
    if (!card.cloze && isTypableAnswer(card.back)) {
      card.answer = typableAnswerText(card.back);
      card.name = `${card.name}{{type:Input}}`;
      card.enableInput = true;
    }
  }

  private async transformCard(
    card: Note,
    counter: number,
    ws: Workspace
  ): Promise<void> {
    card.number = counter;

    if (card.mcq) {
      card.media = [];
      if (!card.tags) {
        card.tags = [];
      }
      return;
    }

    card.cloze = this.settings.isCloze;
    this.noteStrayClozeMarkup(card);

    if (card.cloze) {
      const headerHasCloze = hasInlineClozeCode(card.name);
      if (
        !headerHasCloze &&
        this.settings.clozeFromToggleContent &&
        hasInlineClozeCode(card.back)
      ) {
        const header = card.name;
        card.name = handleClozeDeletions(
          card.back,
          this.settings.groupClozePerToggle
        );
        card.back = header;
      } else {
        card.name = handleClozeDeletions(
          card.name,
          this.settings.groupClozePerToggle
        );
      }
    }

    this.applyInputAnswer(card);

    card.media = [];
    await this.embedCardImages(card, ws);
    this.embedCardAudio(card, ws);
    this.appendCardVideoEmbeds(card);

    if (this.settings.useInput && card.back.includes('<strong>')) {
      const inputInfo = this.treatBoldAsInput(card.back, true);
      card.back = inputInfo.mangle;
    }

    if (!card.tags) {
      card.tags = [];
    }
  }

  private overlappingClozeEnabled(): boolean {
    const style = this.settings.overlappingCloze;
    return (
      this.settings.isCloze && (style === 'show-all' || style === 'windowed')
    );
  }

  private notesFromOverlappingItems(items: string[], source?: Note): Note[] {
    if (items.length < 2) {
      return [];
    }

    const style = this.settings.overlappingCloze as OverlappingClozeStyle;
    const bodies = handleOverlappingCloze(items, style);
    return bodies.map((body, index) => {
      const note = new Note(body, '');
      note.cloze = true;
      if (source) {
        note.tags = source.tags;
        note.notionId = source.notionId
          ? `${source.notionId}::${index}`
          : undefined;
        note.sourcePageId = source.sourcePageId;
        note.notionLink = source.notionLink;
      }
      return note;
    });
  }

  private buildOverlappingClozeNotes(card: Note): Note[] {
    if (
      !this.overlappingClozeEnabled() ||
      card.mcq ||
      card.back.includes('{{c')
    ) {
      return [];
    }

    const items = extractListItems(card.back);
    return this.notesFromOverlappingItems(items, card);
  }

  private buildPageListOverlappingNotes(dom: cheerio.CheerioAPI): Note[] {
    if (!this.overlappingClozeEnabled()) {
      return [];
    }

    const pageBody = dom('.page-body');
    const html = (pageBody.length > 0 ? pageBody : dom('body')).html() ?? '';
    if (html.includes('{{c')) {
      return [];
    }

    const items = extractListItems(html);
    return this.notesFromOverlappingItems(items);
  }

  private findSoleProseBlock(
    dom: cheerio.CheerioAPI
  ): cheerio.Cheerio<Element> | null {
    const pageBody = dom('.page-body');
    const root = pageBody.length > 0 ? pageBody : dom('body');
    const blocks = root
      .children()
      .toArray()
      .filter((node) => {
        const text = dom(node).text().trim();
        return text.length > 0 || dom(node).find('img, iframe').length > 0;
      });

    if (blocks.length !== 1) {
      return null;
    }

    const block = dom(blocks[0]);
    const tag = blocks[0].tagName?.toLowerCase();
    const isProse = tag === 'p' || tag === 'blockquote';
    const hasStructure =
      block.find('ul, ol, details, table, img, iframe').length > 0;
    if (!isProse || hasStructure) {
      return null;
    }

    return block;
  }

  private buildPageParagraphOverlappingNotes(dom: cheerio.CheerioAPI): Note[] {
    if (!this.overlappingClozeEnabled()) {
      return [];
    }

    const block = this.findSoleProseBlock(dom);
    if (!block) {
      return [];
    }

    const text = block.text();
    if (text.includes('{{c')) {
      return [];
    }

    const segments = splitParagraphSegments(text);
    return this.notesFromOverlappingItems(segments);
  }

  private pageBodyLooksLikeLines(dom: cheerio.CheerioAPI): boolean {
    const pageBody = dom('.page-body');
    const root = pageBody.length > 0 ? pageBody : dom('body');

    const blocks = root
      .children()
      .toArray()
      .filter((node) => {
        const $node = dom(node);
        return (
          $node.text().trim().length > 0 || $node.find('img, iframe').length > 0
        );
      });

    const everyBlockIsProse = blocks.every((node) => {
      const tag = node.tagName?.toLowerCase();
      const isProse =
        tag === 'p' ||
        tag === 'blockquote' ||
        dom(node).children('p, blockquote').length > 0;
      const hasStructure =
        dom(node).find(
          'ul, ol, details, table, h1, h2, h3, h4, h5, h6, img, iframe, figure'
        ).length > 0;
      return isProse && !hasStructure;
    });
    if (!everyBlockIsProse) {
      return false;
    }

    const html = root.html() ?? '';
    const lines = extractTextLines(html);
    if (lines.length < 2) {
      return false;
    }

    const everyLineIsLyric = lines.every((line) => {
      const isShort = line.length <= 80;
      const hasMidSentencePunctuation =
        /[.!?][^\s)\]"'»”’]/.test(line) || /[.!?]\s+\S/.test(line);
      const endsLikeSentence = /\.\s*$/.test(line);
      return isShort && !hasMidSentencePunctuation && !endsLikeSentence;
    });
    if (!everyLineIsLyric) {
      return false;
    }

    return !lines.some((line) => line.includes('{{c'));
  }

  private buildPageLinesOverlappingNotes(dom: cheerio.CheerioAPI): Note[] {
    if (!this.overlappingClozeEnabled()) {
      return [];
    }

    if (!this.pageBodyLooksLikeLines(dom)) {
      return [];
    }

    const pageBody = dom('.page-body');
    const html = (pageBody.length > 0 ? pageBody : dom('body')).html() ?? '';
    const lines = extractTextLines(html);
    return this.notesFromOverlappingItems(lines);
  }

  private async processPayload(ws: Workspace): Promise<void> {
    if (this.payload.length === 0) {
      const markdownSourced =
        isMarkdownFile(this.firstDeckName) ||
        isMarkdownSourcedFiles(this.files);
      throw new EmptyDeckError(
        markdownSourced ? 'markdown' : undefined,
        this.emptyDeckReason(),
        this.rescueCandidates
      );
    }

    this.emptyBackCount = 0;
    this.strayClozeCount = 0;
    await runSequentially(this.payload, async (deck) => {
      deck.id = get16DigitRandomId();

      let counter = 0;
      const addThese: Note[] = [];
      const replaced = new Set<Note>();
      await runSequentially(deck.cards, async (c) => {
        let card = c;
        await this.transformCard(card, counter++, ws);

        if (this.settings.useTags) {
          card = this.locateTags(card, deck.globalTags);
        }

        const overlappingNotes = this.buildOverlappingClozeNotes(card);
        if (overlappingNotes.length > 0) {
          for (const note of overlappingNotes) {
            note.number = counter++;
          }
          addThese.push(...overlappingNotes);
          replaced.add(c);
          return;
        }

        const refreshIconRequested = card.hasRefreshIcon();
        const reversible = card.isReversibleBasic();
        if (
          (this.settings.basicReversed || refreshIconRequested) &&
          reversible
        ) {
          const note = card.reversed(card);
          note.number = counter++;
          addThese.push(note);
        }

        if (this.settings.reversed && reversible) {
          const tmp = card.back;
          card.back = card.name;
          card.name = tmp;
        }

        if (refreshIconRequested) {
          card.stripRefreshIcon();
        }
      });
      const kept = deck.cards.filter((card) => !replaced.has(card));
      const produced = kept.concat(addThese);
      this.emptyBackCount += countEmptyBacks(
        produced,
        (card) => card.back,
        (card) => card.name,
        (card) =>
          !card.isValidMCQNote() &&
          !card.isValidClozeNote() &&
          !card.isValidInputNote()
      );
      deck.cards = Deck.CleanCards(produced);
      this.applyGlobalTags(deck.cards);
    });

    this.applyCardLimit();

    this.markUploadDecks();
    this.applyLedgerGuids();
    this.applyUploadIdentityGuids();
    this.emitParentContextEvent();
    this.payload[0].settings = this.settings;
    this.customExporter.configure(this.payload);
  }

  // Fires once per file whose finished deck kept at least one card carrying a
  // parent-context line, counting only cards that survived cleaning so the
  // adoption read measures real use rather than the option being toggled on.
  // Notion HTML exports only; the Notion API path does not apply the option.
  private emitParentContextEvent(): void {
    if (this.parentContextEventEmitted) {
      return;
    }
    const cards = this.payload.reduce(
      (total, deck) =>
        total +
        deck.cards.filter((card) => card.name.includes(PARENT_CONTEXT_MARKER))
          .length,
      0
    );
    if (cards === 0) {
      return;
    }
    this.parentContextEventEmitted = true;
    track('parent_context_enabled', {
      userId: this.ownerUserId,
      props: { cards },
    });
  }

  private applyCardLimit(): void {
    if (this.cardLimit == null) {
      return;
    }
    this.cardsHeldBack = truncateDecksToCardLimit(
      this.payload,
      this.cardLimit
    ).heldBack;
  }

  // Upload decks get the legacy content-formula GUID from python so a deck a
  // user imported before this feature matches on re-upload. The block-id
  // option opts new cards into guid_for(blockId) instead; either way the
  // ledger pins whatever was issued and replays it afterwards.
  private markUploadDecks(): void {
    for (const deck of this.payload) {
      deck.useContentGuid = !this.settings.blockIdIdentity;
    }
  }

  private static readonly NOTION_BLOCK_ID_PATTERN =
    /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

  // The 2026 details export keeps the block UUID on the <details> element
  // inside the synthetic wrapper. Only a Notion-shaped UUID may become card
  // identity: a user-authored id ("faq-1") repeated across toggles or uploads
  // would collide collection-wide in Anki and silently overwrite notes.
  private resolveToggleBlockId(
    parentUL: cheerio.Cheerio<Element>
  ): string | undefined {
    const wrapperId = parentUL.attr('id');
    if (wrapperId) {
      return wrapperId;
    }
    const detailsId = parentUL.children('li').children('details').attr('id');
    if (detailsId && DeckParser.NOTION_BLOCK_ID_PATTERN.test(detailsId)) {
      return detailsId;
    }
    return undefined;
  }

  // Block-id identity is a recovery switch: while it is on, every toggle is
  // re-keyed to guid_for(blockId) by python and the ledger is rewritten to
  // follow, so a stored content-formula GUID must not win here.
  private applyLedgerGuids(): void {
    if (this.knownGuids == null || this.settings.blockIdIdentity) {
      return;
    }
    for (const deck of this.payload) {
      for (const card of deck.cards) {
        if (card.notionId == null) {
          continue;
        }
        const stored = this.knownGuids[card.notionId];
        if (stored != null) {
          card.guid = stored;
        }
      }
    }
  }

  // The upload-identity path for signed-in, non-Notion uploads. It computes a
  // content-stable identity key (front + card type, deck name excluded), sets
  // the guid python then honours unconditionally, and runs the ambiguity guard
  // against the ledger so a re-upload replays the same guid instead of adding a
  // duplicate. Notion cards keep the block-id path above; anonymous uploads and
  // ineligible formats never reach here, so their output is unchanged.
  private applyUploadIdentityGuids(): void {
    if (this.uploadIdentity == null) {
      return;
    }
    const { owner, ledger } = this.uploadIdentity;
    const now = Math.floor(Date.now() / 1000);
    const groups = new Map<
      string,
      Array<{ card: Note; fingerprint: string }>
    >();
    for (const deck of this.payload) {
      for (const card of deck.cards) {
        if (card.notionId != null) {
          continue;
        }
        const baseKey = uploadIdentityKey(card);
        const members = groups.get(baseKey) ?? [];
        members.push({ card, fingerprint: cardFingerprint(card) });
        groups.set(baseKey, members);
      }
    }
    for (const members of groups.values()) {
      const resolved = resolveUploadIdentityGroup({
        owner,
        sourceKeyHash: this.uploadSourceKeyHash,
        keyForOrdinal: (ordinal) => uploadIdentityKey(members[0].card, ordinal),
        cards: members,
        ledger,
        now,
      });
      members.forEach(({ card, fingerprint }, index) => {
        const { identityKey, guid, decision, contentChangedAt } =
          resolved[index];
        card.guid = guid;
        card.mod = contentChangedAt;
        this.uploadIdentityStats[decision] += 1;
        if (decision === 'guarded') {
          return;
        }
        // Replayed rows are written too, so the stored fingerprint and file
        // hash always describe the card's latest upload — otherwise an answer
        // edit followed by a rename (two ordinary re-imports) would trip the
        // guard against a stale row and duplicate the card.
        this.uploadIdentityEntries.push({
          blockId: identityKey,
          guid,
          sourcePageId: packIdentitySource(
            this.uploadSourceKeyHash,
            fingerprint
          ),
          contentChangedAt,
        });
      });
    }
  }

  async build(ws: Workspace): Promise<Buffer> {
    if (ws.location !== this.workspace.location) {
      console.debug('workspace location changed for build');
      console.debug(ws.location);
      this.customExporter = new CustomExporter(this.firstDeckName, ws.location);
    }

    await this.processPayload(ws);
    const apkg = await this.customExporter.save();
    this.issuedGuidEntries = this.collectGuidEntries(ws.location);
    return apkg;
  }

  private collectGuidEntries(location: string): IssuedCardGuid[] {
    const notionEntries =
      this.knownGuids != null && this.settings.blockIdIdentity
        ? collectRekeyedGuids(location, this.payload, this.knownGuids)
        : collectIssuedGuids(location, this.payload, this.knownGuids);
    return [...notionEntries, ...this.uploadIdentityEntries];
  }

  async writeDeckInfo(ws: Workspace): Promise<string> {
    if (ws.location !== this.workspace.location) {
      this.customExporter = new CustomExporter(this.firstDeckName, ws.location);
    }

    await this.processPayload(ws);
    return this.customExporter.deckInfoPath();
  }

  tryExperimental() {
    const fallback = new FallbackParser(this.files);

    this.payload = fallback.run(this.settings);
    this.droppedImageCount += fallback.droppedImageCount;
    this.plainTextFallbackImageCount += fallback.droppedImageCount;
    if (
      !this.payload ||
      this.payload.length === 0 ||
      this.totalCardCount() === 0
    ) {
      const markdownSourced =
        isMarkdownFile(this.firstDeckName) ||
        isMarkdownSourcedFiles(this.files);
      throw new EmptyDeckError(
        markdownSourced ? 'markdown' : undefined,
        this.emptyDeckReason(),
        this.rescueCandidates
      );
    }

    this.applyCardLimit();
    this.markUploadDecks();
    this.applyUploadIdentityGuids();
    this.issuedGuidEntries = this.uploadIdentityEntries;
    this.payload[0].settings = this.settings;
    this.customExporter.configure(this.payload);

    return this.customExporter.save();
  }

  totalCardCount() {
    return this.payload.reduce((total, p) => total + p.cardCount, 0);
  }

  // Why an empty parse produced no cards, derived from state the parse already
  // holds — no second pass. A user filter that emptied the deck wins first
  // (cherry-pick keeps only 🍒 toggles, 🥑 skips), then a page with no readable
  // text, then text that held no structure the parser recognises; anything else
  // stays honest as unknown.
  emptyDeckReason(): EmptyDeckReason {
    if (this.cardsRemovedByUserFilter > 0) {
      return 'all_filtered';
    }
    if (!this.meaningfulTextSeen) {
      return 'no_content';
    }
    if (this.recognizedCardStructureCount === 0) {
      return 'no_toggles';
    }
    return 'unknown';
  }

  private keepOrDropCard(note: Note, cards: Note[]): boolean {
    this.recognizedCardStructureCount += 1;
    if (this.dropsByMatchingRules(note)) {
      this.cardsRemovedByUserFilter += 1;
      console.debug('dropping due to matching rules');
      return false;
    }
    cards.push(note);
    return true;
  }

  // Runs on the raw string, before any DOM exists: a page whose images are
  // base64 data URIs is mostly picture bytes, and every copy the parse makes
  // of the HTML (the cheerio tree, each card's front and back, the exporter
  // payload) would carry them. The bytes go to the workspace under the same
  // content-hash name embedFile gives a local image, so the build step finds
  // them as an ordinary relative image and bundles them like any other.
  // With embed-images off the build step never bundles anything, so the data
  // URI has to stay inline for Anki to show the picture at all.
  private unpackDataUriImages(contents: string): string {
    if (!this.settings.embedImages) {
      return contents;
    }
    const written = new Set<string>();
    const { html, count, bytes } = extractDataUriImages(
      contents,
      (image, extension) => {
        const fileName = `${getUniqueFileName(image)}.${extension}`;
        if (!written.has(fileName)) {
          this.customExporter.addMedia(fileName, image);
          written.add(fileName);
        }
        return fileName;
      }
    );
    if (count > 0) {
      console.info('[DeckParser] unpacked embedded images', {
        count,
        bytes,
        htmlBytesBefore: contents.length,
        htmlBytesAfter: html.length,
      });
    }
    return html;
  }

  private loadDOM(contents: string) {
    return cheerio.load(
      this.removeNewlinesInSVGPathAttributeD(
        this.settings.noUnderline
          ? contents.replace(/border-bottom:0.05em solid/g, '')
          : contents
      )
    );
  }

  private loadAndNormalizeDOM(contents: string): {
    dom: cheerio.CheerioAPI;
    isNewFormat: boolean;
  } {
    const dom = this.loadDOM(contents);
    normalizeNotionEquations(dom);
    unwrapNotionDefaultHighlights(dom);
    this.reshapeBareToggleDetails(dom);
    const isNewFormat = this.hasNotionNewExportFormat(dom);
    this.normalizeNotionNewExportFormat(dom);
    this.expandToggleHeadingSections(dom);
    this.applyCodeBlockContainer(dom);
    return { dom, isNewFormat };
  }

  private applyCodeBlockContainer(dom: cheerio.CheerioAPI): void {
    dom('pre > code').each((_i, elem) => {
      const code = dom(elem);
      if (code.hasClass('hljs')) return;
      code.html(highlightCode(code.text()));
      code.addClass('hljs');
    });
  }

  private reshapeBareToggleDetails(dom: cheerio.CheerioAPI): void {
    dom('details.toggle').each((_, el) => {
      const $details = dom(el);
      $details.removeClass('toggle');
      const $body = $details.children('div.indented').first();
      if ($body.length > 0) {
        $body.removeClass('indented');
        $body.attr('style', 'display:contents');
      }
      $details.wrap(
        '<div style="display:contents"><ul class="toggle"><li></li></ul></div>'
      );
    });
  }

  private normalizeNotionNewExportFormat(dom: cheerio.CheerioAPI): void {
    if (!this.hasNotionNewExportFormat(dom)) {
      return;
    }

    // Only preserve nested toggles as HTML content if maxOne is true
    // If maxOne is false, skip the preservation so nested toggles remain as separate elements
    if (this.settings.maxOne) {
      this.preserveNestedTogglesBeforeFlattening(dom);
    }
    this.flattenDisplayContentsElements(dom);
  }

  private preserveNestedTogglesBeforeFlattening(dom: cheerio.CheerioAPI): void {
    dom('[style*="display:contents"] ul.toggle > li > details').each(
      (_, details) => {
        const $details = dom(details);
        this.processNestedTogglesDepthFirst($details, dom);
      }
    );
  }

  private processNestedTogglesDepthFirst(
    $details: cheerio.Cheerio<Element>,
    dom: cheerio.CheerioAPI
  ): void {
    $details.find('[style*="display:contents"]').each((_, displayContents) => {
      const $displayContents = dom(displayContents);
      const $nestedUl = $displayContents.children('ul.toggle').first();

      if ($nestedUl.length > 0) {
        const $li = $nestedUl.children('li').first();
        const $nestedDetails = $li.children('details').first();

        if ($nestedDetails.length > 0) {
          this.processNestedTogglesDepthFirst($nestedDetails, dom);

          const $summary = $nestedDetails.children('summary').first();
          const summaryHTML = $summary.html()?.trim();

          if (summaryHTML) {
            const $contentAfterSummary = $nestedDetails
              .contents()
              .not('summary');
            let contentHTML = '';

            $contentAfterSummary.each((_, content) => {
              if (dom(content).is('[style*="display:contents"]')) {
                contentHTML += dom(content).html() || '';
              } else {
                contentHTML += dom(content).toString();
              }
            });

            const nestedId = $nestedDetails.attr('id') ?? $nestedUl.attr('id');
            const idAttr =
              nestedId && DeckParser.NOTION_BLOCK_ID_PATTERN.test(nestedId)
                ? ` id="${nestedId}"`
                : '';
            const nestedDetailsHTML = `<details${idAttr} style="margin-left: 20px; margin-bottom: 10px;">
              <summary>${summaryHTML}</summary>
              ${contentHTML}
            </details>`;

            $displayContents.replaceWith(nestedDetailsHTML);
          } else {
            $displayContents.replaceWith($displayContents.contents());
          }
        } else {
          $displayContents.replaceWith($displayContents.contents());
        }
      } else {
        $displayContents.replaceWith($displayContents.contents());
      }
    });
  }

  private hasNotionNewExportFormat(dom: cheerio.CheerioAPI): boolean {
    return dom('[style*="display:contents"]').length > 0;
  }

  private flattenDisplayContentsElements(dom: cheerio.CheerioAPI): void {
    dom('[style*="display:contents"]').each((_, el) => {
      const $el = dom(el);
      $el.replaceWith($el.contents());
    });
  }

  private extractCoverImage(dom: cheerio.CheerioAPI) {
    const pageCoverImage = dom('.page-cover-image');
    if (pageCoverImage) {
      return pageCoverImage.attr('src');
    }
    return undefined;
  }

  private subPageName(
    figure: cheerio.Cheerio<Element>,
    link: cheerio.Cheerio<Element>
  ): string {
    const title = figure.find('title').text() || link.text();
    const emoji = link.find('.icon').first().attr('data-emoji');
    if (
      !emoji ||
      title.includes(emoji) ||
      this.settings.pageEmoji === 'disable_emoji'
    ) {
      return title;
    }
    return this.settings.pageEmoji === 'first_emoji'
      ? `${emoji}${title}`
      : `${title} ${emoji}`;
  }

  private extractPageIcon(dom: cheerio.CheerioAPI) {
    const pageIcon = dom('.page-header-icon > .icon');
    return pageIcon.attr('data-emoji') || pageIcon.html();
  }

  private extractToggleLists(dom: cheerio.CheerioAPI): Element[] {
    const foundToggleLists = findNotionToggleLists(dom, {
      isCherry: this.settings.isCherry,
      isAll: this.settings.isAll,
      disableIndentedBulletPoints: this.settings.disableIndentedBulletPoints,
    });

    // Only outermost toggles. transformDetailsTagToNotionToggleList moves each
    // <details> it is handed into a fresh wrapper, so passing a nested toggle
    // tears it out of its parent and leaves the parent card with an empty back.
    // A nested toggle stays folded into its parent's back, matching the
    // top-level .page-body > ul path.
    const details: Element[] = dom('details')
      .toArray()
      .filter((el) => dom(el).parents('details').length === 0);

    // Remove duplicate toggles caused by merged ul.toggle
    const uniqueToggles: Element[] = [];
    const seen = new Set();
    foundToggleLists.forEach((t, index) => {
      const explicitId = dom(t).attr('id');
      const key = explicitId ?? `${index}:${dom(t).html()}`;
      if (!seen.has(key)) {
        uniqueToggles.push(t);
        seen.add(key);
      }
    });

    const convertedToggleLists =
      uniqueToggles.length === 0 && details.length > 0
        ? transformDetailsTagToNotionToggleList(dom, details)
        : [];

    return [
      ...uniqueToggles,
      ...convertedToggleLists,
      ...this.findIndentedToggleLists(dom),
    ];
  }

  private buildMCQNote(
    front: string,
    toggleElement: cheerio.Cheerio<Element>,
    dom: cheerio.CheerioAPI,
    correctIndex: number
  ): Note {
    const listItems = toggleElement
      .find('ul.to-do-list > li, ul.bulleted-list > li')
      .toArray();
    const options = listItems.map((li) => {
      const $li = dom(li);
      $li.find('.checkbox').remove();
      return $li.text().trim();
    });

    const explanation = toggleElement
      .find('> p, > blockquote, > .callout')
      .map((_i, el) => dom(el).html() ?? '')
      .toArray()
      .join('');

    const note = new Note(front, explanation);
    note.mcq = true;
    note.options = options;
    note.correctIndices = [correctIndex];
    return note;
  }

  // Prepends the nearest enclosing bullet or parent toggle of a nested card's
  // summary as a muted line above the question so an outline card ("ACS")
  // carries the condition it belongs to. One level only: the closest bullet or
  // toggle ancestor wins, mirroring the collectSectionTags ancestor walk. The
  // muted style is inline, not a stylesheet rule, so returning users on a
  // pinned note type and the non-notion templates still render it. Runs only
  // after cherry/avocado filtering has kept the card, on the card's own front,
  // so a cherry or avocado emoji in the parent never changes which cards ship.
  // A top-level toggle has no ancestor, so its front stays byte-identical and
  // keeps its existing guid.
  private applyParentContext(
    dom: cheerio.CheerioAPI,
    summary: cheerio.Cheerio<Element>,
    note: Note
  ): void {
    if (!this.settings.parentContext) {
      return;
    }
    const text = this.nearestParentContextText(dom, summary);
    if (!text) {
      return;
    }
    const capped =
      text.length > PARENT_CONTEXT_MAX_CHARS
        ? `${text.slice(0, PARENT_CONTEXT_MAX_CHARS - 1)}…`
        : text;
    note.name = `<div class="parent-context" style="${PARENT_CONTEXT_STYLE}">${escapeContextText(capped)}</div>${note.name}`;
  }

  private nearestParentContextText(
    dom: cheerio.CheerioAPI,
    summary: cheerio.Cheerio<Element>
  ): string {
    const ownDetails = summary.closest('details');
    const start = ownDetails.length > 0 ? ownDetails : summary;
    for (const ancestor of start.parents().toArray()) {
      const $ancestor = dom(ancestor);
      if ($ancestor.is('details')) {
        const text = collapseContextWhitespace(
          $ancestor.children('summary').first().text()
        );
        if (text) {
          return text;
        }
      }
      if ($ancestor.is('li')) {
        const text = bulletOwnText($ancestor);
        if (text) {
          return text;
        }
      }
    }
    return '';
  }

  private extractCards(
    dom: cheerio.CheerioAPI,
    toggleList: Element[],
    isNewFormat: boolean = false
  ): {
    cards: Note[];
    mcqCount: number;
    mcqSkippedCount: number;
  } {
    const cards: Note[] = [];
    let mcqCount = 0;
    let mcqSkippedCount = 0;
    let promotedCount = 0;
    const pageId = dom('article').attr('id');

    const sectionTagOwners =
      this.settings.useSectionTags && this.settings.isCherry
        ? collectAndStripSectionMarkers(dom)
        : undefined;

    toggleList.forEach((t) => {
      // We want to perserve the parent's style, so getting the class
      const p = dom(t);
      const parentUL = p;
      const parentClass = p.attr('class') || '';
      const sectionTags = sectionTagOwners
        ? ancestorSectionTags(dom, t, sectionTagOwners)
        : [];

      if (this.settings.toggleMode === 'open_toggle') {
        dom('details').attr('open', '');
      } else if (this.settings.toggleMode === 'close_toggle') {
        dom('details').removeAttr('open');
      }

      if (parentUL) {
        parentUL.find('details').addClass(parentClass);
        parentUL.find('summary').addClass(parentClass);
        const summary = parentUL.find('summary').first();
        let toggle = parentUL.find('details').first();

        if (!toggle?.html()) {
          toggle = parentUL.find('.indented');
        }

        const summaryHasMedia =
          summary.find('img, figure, audio, video').length > 0;
        if (summary && (summary.text() || summaryHasMedia)) {
          const validSummary = (() =>
            preserveNewlinesIfApplicable(
              summary.html() || '',
              this.settings
            ))();
          const front = parentClass
            ? `<div class='${parentClass}'>${validSummary}</div>`
            : validSummary;
          if (toggle || this.settings.maxOne) {
            const nestedToggleCards = this.promoteNestedToggles(
              toggle,
              dom,
              parentClass,
              isNewFormat
            );
            const promoted = [
              ...nestedToggleCards,
              ...this.promoteNestedClozeToggles(
                toggle,
                dom,
                parentClass,
                isNewFormat
              ),
            ];
            promotedCount += promoted.length;
            const toggleHTML = toggle.html();
            if (toggleHTML) {
              const toggleEl = toggle.get(0);
              const mcqEnabled = this.settings.mcqEnabled;
              const correctIndex =
                mcqEnabled && toggleEl ? isMCQ(toggleEl, dom) : -1;
              const hasMCQShape =
                mcqEnabled &&
                toggleEl != null &&
                (dom(toggleEl).find('ul.to-do-list > li').length >= 2 ||
                  dom(toggleEl).find('ul.bulleted-list > li').length >= 2);

              if (hasMCQShape && correctIndex >= 0) {
                const note = this.buildMCQNote(
                  front || '',
                  toggle,
                  dom,
                  correctIndex
                );
                note.notionId = this.resolveToggleBlockId(parentUL);
                note.sourcePageId = pageId;
                note.sectionTags = sectionTags;
                mcqCount++;
                if (this.keepOrDropCard(note, cards)) {
                  this.applyParentContext(dom, summary, note);
                }
                return;
              }

              if (hasMCQShape && correctIndex === -1) {
                mcqSkippedCount++;
              }

              const b = toggleHTML.replace(summary.html() || '', '');
              const builtBack = this.buildToggleBackSide(b, isNewFormat);
              const plainOrRichBack = this.settings.isTextOnlyBack
                ? toPlainTextBack(builtBack)
                : builtBack;
              const backSide = /\bblock-color-/.test(parentClass)
                ? `<div class='${parentClass}'>${plainOrRichBack}</div>`
                : plainOrRichBack;
              const note = new Note(front || '', backSide);
              note.notionId = this.resolveToggleBlockId(parentUL);
              note.sourcePageId = pageId;
              note.sectionTags = sectionTags;
              if (note.notionId && this.settings.addNotionLink) {
                const link = this.getLink(pageId, note);
                if (link !== null) {
                  note.back += link;
                }
              }
              if (this.keepOrDropCard(note, cards)) {
                this.applyParentContext(dom, summary, note);
              }
              for (const child of promoted) {
                child.sourcePageId = pageId;
                child.sectionTags = sectionTags;
                this.keepOrDropCard(child, cards);
              }
            }
          }
        }
      }
    });
    if (promotedCount > 0) {
      console.info(
        '[nested-toggles] promoted nested toggles to their own cards',
        {
          count: promotedCount,
        }
      );
    }
    return { cards, mcqCount, mcqSkippedCount };
  }

  private dropsByMatchingRules(note: Note): boolean {
    return (
      (this.settings.isAvocado && this.noteHasAvocado(note)) ||
      (this.settings.isCherry && !this.noteHasCherry(note))
    );
  }

  private buildToggleBackSide(body: string, isNewFormat: boolean): string {
    let back = body;
    if (this.settings.maxOne) {
      back = isNewFormat
        ? this.removeNestedTogglesNewFormat(body)
        : this.removeNestedTogglesLegacy(body);
    }
    back = back.replace(/<summary\b[^>]*><\/summary>/g, '');
    if (this.settings.perserveNewLines) {
      back = replaceAll(back, '\n', '<br />');
    }
    return back;
  }

  // Opt-in (promote-nested-toggles): every toggle nested inside this one with
  // something inside it becomes its own card, title as the question. Under
  // cherry-pick every toggle is already a candidate on its own, so it is a
  // no-op there rather than a source of duplicate cards. The
  // parent keeps its own card. A nested toggle that the cloze option promotes
  // is left to it, and is skipped here so it never becomes two cards.
  private promoteNestedToggles(
    toggle: cheerio.Cheerio<Element>,
    dom: cheerio.CheerioAPI,
    parentClass: string,
    isNewFormat: boolean
  ): Note[] {
    if (!this.settings.promoteNestedToggles || this.settings.isCherry) {
      return [];
    }
    const clozePromotes =
      this.settings.isCloze && this.settings.promoteNestedCloze;
    const captured = toggle
      .find('details')
      .toArray()
      .map((el) => {
        const $details = dom(el);
        const $summary = $details.children('summary').first();
        const body = ($details.html() ?? '').replace($summary.toString(), '');
        return {
          $details,
          summaryHTML: $summary.html() ?? '',
          summaryText: $summary.text().trim(),
          body,
        };
      })
      .filter(
        ({ summaryText, summaryHTML, body }) =>
          summaryText.length > 0 &&
          bodyHasContent(body) &&
          !(clozePromotes && hasInlineClozeCode(summaryHTML))
      );
    return captured.map(({ $details, summaryHTML, body }) => {
      const front = preserveNewlinesIfApplicable(summaryHTML, this.settings);
      const note = new Note(
        parentClass ? `<div class='${parentClass}'>${front}</div>` : front,
        this.buildToggleBackSide(body, isNewFormat)
      );
      note.notionId = this.resolveNestedToggleBlockId($details);
      return note;
    });
  }

  // A nested toggle whose title carries the inline-code cloze marker is a
  // cloze card the author wrote, not answer text for the parent. Opt-in
  // (promote-nested-cloze) because the #3515 contract keeps every nested fact
  // folded into the parent back, and a real export with this exact shape
  // wanted that. Fronts are captured before the markers are unwrapped, so the
  // parent back, built from the same DOM afterwards, shows the fact in bold
  // with no code box.
  private promoteNestedClozeToggles(
    toggle: cheerio.Cheerio<Element>,
    dom: cheerio.CheerioAPI,
    parentClass: string,
    isNewFormat: boolean
  ): Note[] {
    if (
      !this.settings.isCloze ||
      !this.settings.promoteNestedCloze ||
      this.settings.isCherry
    ) {
      return [];
    }
    const captured = toggle
      .find('details')
      .toArray()
      .map((el) => {
        const $details = dom(el);
        const $summary = $details.children('summary').first();
        return { $details, $summary, summaryHTML: $summary.html() ?? '' };
      })
      .filter(({ summaryHTML }) => hasInlineClozeCode(summaryHTML))
      .map(({ $details, $summary, summaryHTML }) => ({
        $details,
        $summary,
        front: preserveNewlinesIfApplicable(summaryHTML, this.settings),
        notionId: this.resolveNestedToggleBlockId($details),
      }));
    for (const { $summary } of captured) {
      $summary.find('code').each((_, code) => {
        const $code = dom(code);
        if ($code.parents('pre').length > 0) return;
        $code.replaceWith(`<b>${$code.html() ?? ''}</b>`);
      });
    }
    return captured.map(({ $details, $summary, front, notionId }) => {
      const body = ($details.html() ?? '').replace($summary.toString(), '');
      const note = new Note(
        parentClass ? `<div class='${parentClass}'>${front}</div>` : front,
        this.buildToggleBackSide(body, isNewFormat)
      );
      note.notionId = notionId;
      return note;
    });
  }

  // The block UUID sits either on the nested <details> itself (the bare
  // details.toggle export and the max-one rebuild) or on its own wrapping
  // ul.toggle (the display:contents export). Only the nested toggle's own
  // wrapper counts, never an ancestor's, or the child would inherit the
  // parent's identity and overwrite it in Anki.
  private resolveNestedToggleBlockId(
    $details: cheerio.Cheerio<Element>
  ): string | undefined {
    const $li = $details.parent();
    const wrapperId = $li.is('li')
      ? $li.parent().filter('ul.toggle').attr('id')
      : undefined;
    const id = $details.attr('id') ?? wrapperId;
    return id && DeckParser.NOTION_BLOCK_ID_PATTERN.test(id) ? id : undefined;
  }

  private unclassifiedCardSurvives(note: Note): boolean {
    return this.settings.isCloze || noteHasAnswerSide(note);
  }

  private extractCardsFromParagraph(dom: cheerio.CheerioAPI) {
    const paragraphs = dom('p').toArray();
    return paragraphs.map((p) => new Note(dom(p).html() ?? '', ''));
  }

  private extractCardsFromLists(
    dom: cheerio.CheerioAPI,
    disableIndentedBullets: boolean
  ) {
    const cards: Note[] = [];
    const lists = disableIndentedBullets
      ? [...dom('.page-body > .bulleted-list').toArray()]
      : [...dom('ul').toArray(), ...dom('ol').toArray()];

    lists.forEach((list) => {
      if (disableIndentedBullets) {
        cards.push(new Note(dom(list).html() ?? '', ''));
      } else {
        for (const child of dom(list).find('li')) {
          cards.push(new Note(dom(child).html() ?? '', ''));
        }
      }
    });

    return cards;
  }
}

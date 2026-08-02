import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

import preserveNewlinesIfApplicable from '../../services/NotionService/helpers/preserveNewlinesIfApplicable';
import { collectIssuedGuids } from '../anki/collectIssuedGuids';
import type { IssuedCardGuid, KnownGuids } from '../anki/guidLedgerTypes';
import sanitizeTags from '../anki/sanitizeTags';
import { File } from '../zip/zip';
import Deck from './Deck';
import Note from './Note';
import { countEmptyBacks } from './countEmptyBacks';
import { isTypableAnswer, typableAnswerText } from './isTypableAnswer';
import { noteHasAnswerSide } from './noteHasAnswerSide';
import CardOption from './Settings';
import Workspace from './WorkSpace';
import CustomExporter from './exporters/CustomExporter';
import handleClozeDeletions from './helpers/handleClozeDeletions';
import hasInlineClozeCode from './helpers/hasInlineClozeCode';
import handleOverlappingCloze, {
  OverlappingClozeStyle,
} from './helpers/handleOverlappingCloze';
import extractListItems from './helpers/extractListItems';
import extractTextLines from './helpers/extractTextLines';
import splitParagraphSegments from './helpers/splitParagraphSegments';
import {
  extractHeadingFromSummary,
  extractHeadingMarkup,
} from './helpers/extractHeadingFromSummary';
import replaceAll from './helpers/replaceAll';

import get16DigitRandomId from '../../shared/helpers/get16DigitRandomId';
import { isValidAudioFile } from '../anki/format';
import FallbackParser from './experimental/FallbackParser';
import { embedFile } from './exporters/embedFile';
import { resolveNotionS3ImageFromZip } from './exporters/resolveNotionS3ImageFromZip';
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
} from '../storage/checks';
import { getFileContents } from './getFileContents';
import { normalizeNotionEquations } from './normalizeNotionEquations';
import { handleNestedBulletPointsInMarkdown } from './handleNestedBulletPointsInMarkdown';
import {
  guessMarkdownCards,
  MarkdownHeuristicResult,
} from './guessMarkdownCards';
import { getTitleFromMarkdown } from './getTitleFromMarkdown';
import { extractStyles } from './extractStyles';
import { withFontSize } from './withFontSize';
import { withTextColor } from './withTextColor';
import { withTextAlign } from './withTextAlign';
import { NOTION_STYLE, getCodeThemeCss } from '../../templates/helper';
import { highlightCode } from '../notion-render/highlightCode';
import { transformDetailsTagToNotionToggleList } from './transformDetailsTagToNotionToggleList';
import { findNotionToggleLists, isMCQ } from './findNotionToggleLists';
import {
  ancestorSectionTags,
  collectAndStripSectionMarkers,
} from './collectSectionTags';
import { EmptyDeckError } from '../../usecases/jobs/EmptyDeckError';
import { extractName } from '../extractDeckName';
import {
  InducedRescue,
  InducedRule,
  mergeInducedRescue,
} from './induction/candidateRules';
import { runInduction } from './induction/rankCandidates';
import { scoreCandidateDeck } from './scoreCandidateDeck';
import {
  domPlainTextLength,
  induceCardsFromDom,
  UPLOAD_CANDIDATE_RULES,
} from './induction/induceCardsFromDom';

const MARKDOWN_SOURCE_RATIO_THRESHOLD = 0.8;

// Notion code blocks export as <pre class="code code-wrap"> and rely on
// .code-wrap { white-space: pre-wrap } to wrap long lines. extractStyles
// strips every white-space: pre-wrap rule (it harms body/toggle text), which
// left code blocks running off the edge of narrow cards. Re-apply wrapping to
// code blocks only, appended last so it wins the cascade over the stripped rule.
const CODE_WRAP_STYLE = '.code-wrap, pre { white-space: pre-wrap; }';

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
  knownGuids?: KnownGuids;
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

export class DeckParser {
  firstDeckName: string;

  settings: CardOption;

  payload: Deck[];

  files: File[];

  noLimits: boolean;

  usedHeuristic: boolean;

  droppedImageCount: number;

  emptyBackCount: number;

  private readonly knownGuids?: KnownGuids;

  issuedGuidEntries: IssuedCardGuid[] = [];

  inducedRule?: InducedRescue;

  private sawUnclassifiedParse: boolean;

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
    this.firstDeckName = input.name;
    this.noLimits = input.noLimits;
    this.usedHeuristic = false;
    this.droppedImageCount = 0;
    this.emptyBackCount = 0;
    this.sawUnclassifiedParse = false;
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
      this.settings.deckName ?? getTitleFromMarkdown(contentsStr) ?? name,
      heuristic.notes,
      '',
      '',
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

  handleHTML(
    fileName: string,
    contents: string,
    deckName: string,
    decks: Deck[],
    inheritedGlobalTags: string[] = []
  ) {
    const { dom, isNewFormat } = this.loadAndNormalizeDOM(contents);

    const extractedStyle = extractStyles(dom);
    const codeThemeStyle = getCodeThemeCss(this.settings.codeTheme);
    const themedNotionStyle = `${NOTION_STYLE}\n${codeThemeStyle}`;
    const baseStyle = extractedStyle
      ? `${themedNotionStyle}\n${extractedStyle}`
      : themedNotionStyle;
    const style = withTextAlign(
      withTextColor(
        withFontSize(
          `${baseStyle}\n${CODE_WRAP_STYLE}`,
          this.settings.fontSize
        ),
        this.settings.textColor
      ),
      this.settings.textAlign
    );
    let image: string | undefined = this.extractCoverImage(dom);

    const name = extractName({
      name:
        deckName ||
        dom('title').text() ||
        this.getFirstHeadingText(dom) ||
        fileName ||
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
      const overlappingPageNotes = this.buildPageListOverlappingNotes(dom);
      const overlappingParagraphNotes =
        overlappingPageNotes.length > 0
          ? []
          : this.buildPageParagraphOverlappingNotes(dom);
      const overlappingLineNotes =
        overlappingPageNotes.length > 0 || overlappingParagraphNotes.length > 0
          ? []
          : this.buildPageLinesOverlappingNotes(dom);
      if (overlappingPageNotes.length > 0) {
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
        const subDeckName = spDom.find('title').text() || ref.text();
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
    const { winner, best } = runInduction(
      rules,
      (rule) => induceCardsFromDom(dom, rule),
      domPlainTextLength(dom)
    );
    if (winner == null) {
      if (best != null) {
        this.recordInducedRule({
          rule: best.rule,
          outcome: 'rescue_rejected',
          score: best.score,
        });
      }
      return null;
    }
    this.recordInducedRule({
      rule: winner.rule,
      outcome: 'rescue_shipped',
      score: winner.score,
    });
    return winner.cards;
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

  getLocalAudioFiles(input: string): string[] {
    if (!input) return [];
    const found: string[] = [];
    const seen = new Set<string>();
    const patterns = [
      /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1/gi,
      /<audio[^>]*?\ssrc=(["'])(.*?)\1/gi,
      /<source[^>]*?\ssrc=(["'])(.*?)\1/gi,
    ];
    for (const pattern of patterns) {
      for (const match of input.matchAll(pattern)) {
        const target = match[2];
        if (!target || target.startsWith('http')) continue;
        if (!isValidAudioFile(target) || seen.has(target)) continue;
        seen.add(target);
        found.push(target);
      }
    }
    return found;
  }

  treatBoldAsInput(input: string, inline: boolean) {
    const dom = cheerio.load(input);
    const underlines = dom('strong');
    let mangle = input;
    let answer = '';
    underlines.each((_i, elem) => {
      const v = dom(elem).html();
      if (v) {
        const old = `<strong>${v}</strong>`;
        mangle = replaceAll(mangle, old, inline ? v : '{{type:Input}}');
        answer = v;
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
    try {
      bytes = await downloadMediaOrSkip(url);
    } catch {
      console.warn(`Failed to fetch remote image ${url}`);
    }
    if (bytes == null) {
      this.droppedImageCount++;
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

    for (const elem of images) {
      const originalName = dom(elem).attr('src');
      if (!originalName) continue;

      const handled = this.embedLocalOrZipImage(
        dom,
        elem,
        originalName,
        card,
        ws
      );
      if (handled) continue;

      await this.embedRemoteImage(dom, elem, originalName, card);
    }
    return dom.html();
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

  private embedCardAudio(card: Note, ws: Workspace) {
    const audioFiles = this.getLocalAudioFiles(card.back);
    if (audioFiles.length === 0) return;

    const dom = cheerio.load(card.back);
    const embedded: string[] = [];

    for (const audiofile of audioFiles) {
      const newFileName = embedFile({
        exporter: this.customExporter,
        files: this.files,
        filePath: global.decodeURIComponent(audiofile),
        workspace: ws,
        fallbackWorkspaceLocation: this.workspace.location,
      });
      if (!newFileName) continue;
      embedded.push(newFileName);

      const anchors = dom(`a[href="${audiofile}"]`);
      if (this.settings.removeMP3Links) {
        anchors.each((_i, el) => {
          const figure = dom(el).closest('figure');
          if (figure.length > 0) figure.remove();
          else dom(el).remove();
        });
      }
      // A left-behind <audio> element points at a path that no longer exists
      // inside the .apkg, so it renders as a dead player; the [sound:] tag
      // below is the working replacement.
      dom(`audio[src="${audiofile}"], source[src="${audiofile}"]`).each(
        (_i, el) => {
          const element = dom(el);
          const player = element.closest('audio');
          if (player.length > 0) player.remove();
          else element.remove();
        }
      );
    }

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

    card.enableInput = this.settings.useInput;
    card.cloze = this.settings.isCloze;

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

    if (this.settings.useInput && card.name.includes('<strong>')) {
      const inputInfo = this.treatBoldAsInput(card.name, false);
      card.name = inputInfo.mangle;
      card.answer = inputInfo.answer;
    } else if (
      this.settings.useInput &&
      !card.cloze &&
      isTypableAnswer(card.back)
    ) {
      card.answer = typableAnswerText(card.back);
      card.name = `${card.name}{{type:Input}}`;
    }

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
      throw new EmptyDeckError(markdownSourced ? 'markdown' : undefined);
    }

    this.emptyBackCount = 0;
    for (const d of this.payload) {
      const deck = d;
      deck.id = get16DigitRandomId();

      let counter = 0;
      const addThese: Note[] = [];
      const replaced = new Set<Note>();
      for (const c of deck.cards) {
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
          continue;
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
      }
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
    }

    this.markUploadDecks();
    this.applyLedgerGuids();
    this.payload[0].settings = this.settings;
    this.customExporter.configure(this.payload);
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

  private applyLedgerGuids(): void {
    if (this.knownGuids == null) {
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

  async build(ws: Workspace): Promise<Buffer> {
    if (ws.location !== this.workspace.location) {
      console.debug('workspace location changed for build');
      console.debug(ws.location);
      this.customExporter = new CustomExporter(this.firstDeckName, ws.location);
    }

    await this.processPayload(ws);
    const apkg = await this.customExporter.save();
    this.issuedGuidEntries = collectIssuedGuids(
      ws.location,
      this.payload,
      this.knownGuids
    );
    return apkg;
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
    if (
      !this.payload ||
      this.payload.length === 0 ||
      this.totalCardCount() === 0
    ) {
      const markdownSourced =
        isMarkdownFile(this.firstDeckName) ||
        isMarkdownSourcedFiles(this.files);
      throw new EmptyDeckError(markdownSourced ? 'markdown' : undefined);
    }

    this.markUploadDecks();
    this.payload[0].settings = this.settings;
    this.customExporter.configure(this.payload);

    return this.customExporter.save();
  }

  totalCardCount() {
    return this.payload.reduce((total, p) => total + p.cardCount, 0);
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
    this.reshapeBareToggleDetails(dom);
    const isNewFormat = this.hasNotionNewExportFormat(dom);
    this.normalizeNotionNewExportFormat(dom);
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

            const nestedDetailsHTML = `<details style="margin-left: 20px; margin-bottom: 10px;">
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

    const details: Element[] = dom('details').toArray();

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
                if (
                  (this.settings.isAvocado && this.noteHasAvocado(note)) ||
                  (this.settings.isCherry && !this.noteHasCherry(note))
                ) {
                  console.debug('dropping due to matching rules');
                } else {
                  cards.push(note);
                }
                return;
              }

              if (hasMCQShape && correctIndex === -1) {
                mcqSkippedCount++;
              }

              let b = toggleHTML.replace(summary.html() || '', '');
              if (this.settings.isTextOnlyBack) {
                const paragraphs = dom(toggle).find('> p').toArray();
                b = '';
                for (const paragraph of paragraphs) {
                  if (paragraph) {
                    b += dom(paragraph).html();
                  }
                }
              }

              const backSide = (() => {
                let mangleBackSide = b;
                if (this.settings.maxOne) {
                  mangleBackSide = isNewFormat
                    ? this.removeNestedTogglesNewFormat(b)
                    : this.removeNestedTogglesLegacy(b);
                }
                mangleBackSide = mangleBackSide.replaceAll(
                  '<summary class="toggle"></summary>',
                  ''
                );
                if (this.settings.perserveNewLines) {
                  mangleBackSide = replaceAll(mangleBackSide, '\n', '<br />');
                }
                return mangleBackSide;
              })();
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
              if (
                (this.settings.isAvocado && this.noteHasAvocado(note)) ||
                (this.settings.isCherry && !this.noteHasCherry(note))
              ) {
                console.debug('dropping due to matching rules');
              } else {
                cards.push(note);
              }
            }
          }
        }
      }
    });
    return { cards, mcqCount, mcqSkippedCount };
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

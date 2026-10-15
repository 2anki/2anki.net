import { decompress as zstdDecompress } from 'fzstd';
import ApkgPreviewService, {
  ParsedApkg,
} from '../../services/ApkgPreviewService/ApkgPreviewService';
import PdfRenderService, {
  PdfRenderCrashedError,
  PdfRenderTimeoutError,
} from '../../services/PdfRenderService';
import { RenderedCard } from '../../services/ApkgPreviewService/types';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

const MAX_CARDS = 1000;

const SOUND_TAG_REGEX = /\[sound:([^\]]+)\]/g;
const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'ogg',
  'oga',
  'wav',
  'flac',
  'm4a',
  'aac',
  'opus',
]);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov']);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isAudioOrVideo(name: string): boolean {
  const ext = extensionOf(name);
  return AUDIO_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext);
}

function replaceSoundTokens(html: string): string {
  return html.replace(SOUND_TAG_REGEX, (_match, name: string) => {
    const trimmed = name.trim();
    return `<em>[audio: ${escapeHtml(trimmed)}]</em>`;
  });
}

// Collects the deck media a render needs as separate files. Images used to be
// inlined as base64, which made the HTML several times the size of the media
// (one copy per reference) and pushed big decks past Chrome's 100 MiB DevTools
// message limit and V8's maximum string length.
class PdfAssets {
  readonly files = new Map<string, Buffer>();
  private readonly byArchiveName = new Map<string, string>();

  constructor(private readonly parsed: ParsedApkg) {}

  fileFor(nameOnly: string): string | null {
    const archiveName = this.parsed.mediaMap.get(nameOnly);
    if (archiveName == null) return null;
    const existing = this.byArchiveName.get(archiveName);
    if (existing != null) return existing;
    let buffer = this.parsed.mediaEntries.get(archiveName);
    if (buffer == null) return null;
    if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZSTD_MAGIC)) {
      buffer = Buffer.from(zstdDecompress(new Uint8Array(buffer)));
    }
    const ext = extensionOf(nameOnly);
    const suffix = /^[a-z0-9]{1,5}$/.test(ext) ? `.${ext}` : '';
    const fileName = `media-${this.files.size}${suffix}`;
    this.files.set(fileName, buffer);
    this.byArchiveName.set(archiveName, fileName);
    return fileName;
  }
}

function replaceMediaWithFiles(html: string, assets: PdfAssets): string {
  const SRC_REGEX = /\b(src)="([^"]+)"/g;
  return html.replace(SRC_REGEX, (_match, attr: string, value: string) => {
    if (value.startsWith('data:') || /^https?:\/\//i.test(value)) {
      return `${attr}="${value}"`;
    }
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      // Keep the raw value; a stray % in a media name is not worth a 500.
    }
    const nameOnly = decoded.split('/').pop() ?? decoded;

    if (isAudioOrVideo(nameOnly)) {
      return `${attr}=""`;
    }

    const fileName = assets.fileFor(nameOnly);
    return `${attr}="${fileName ?? ''}"`;
  });
}

function replaceMissingMediaPlaceholders(html: string): string {
  return html.replace(/data-missing-media="[^"]+"/g, '');
}

function processCardHtml(side: string, assets: PdfAssets): string {
  let result = replaceSoundTokens(side);
  result = replaceMediaWithFiles(result, assets);
  result = replaceMissingMediaPlaceholders(result);
  return result;
}

const HR_REGEX = /<hr\b[^>]*>/i;

// Text plus image sources, whitespace-collapsed: enough to tell whether the
// part of the back before its first <hr> is the {{FrontSide}} copy.
function visibleSignature(html: string): string {
  return html
    .replace(/<img\b[^>]*?\bsrc="([^"]*)"[^>]*>/gi, ' [img:$1] ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A `{{FrontSide}}<hr id=answer>…` back repeats the question; the PDF already
// prints it in the Front column, so only the answer after the <hr> is kept.
// Backs that do not start with the front (AnKing's cloze back puts the
// revealed text before its <hr>) are printed whole.
function answerSide(front: string, back: string): string {
  const hrIndex = back.search(HR_REGEX);
  if (hrIndex === -1) return back;
  const beforeHr = back.substring(0, hrIndex);
  if (visibleSignature(beforeHr) !== visibleSignature(front)) return back;
  return back.substring(hrIndex).replace(HR_REGEX, '');
}

function buildCardRow(
  card: RenderedCard,
  assets: PdfAssets,
  scopeClass: string
): string {
  const front = processCardHtml(card.front, assets);
  const back = processCardHtml(answerSide(card.front, card.back), assets);
  return `<tr>
    <td class="card-cell"><div class="card-content ${scopeClass}">${front}</div></td>
    <td class="card-cell"><div class="card-content ${scopeClass}">${back}</div></td>
  </tr>`;
}

// Chrome ignores <style scoped>, so note-type CSS used to apply to the whole
// document: one deck's `html { display: flex }` or `table { … }` rules
// restyled the PDF's own layout and every other note type. @scope confines
// each stylesheet to its own cards, and each one is emitted once instead of
// twice per card.
class DeckStyles {
  private readonly classByCss = new Map<string, string>();

  scopeClassFor(css: string): string {
    const existing = this.classByCss.get(css);
    if (existing != null) return existing;
    const scopeClass = `deck-css-${this.classByCss.size}`;
    this.classByCss.set(css, scopeClass);
    return scopeClass;
  }

  toHtml(): string {
    return Array.from(this.classByCss.entries())
      .map(
        ([css, scopeClass]) =>
          `<style>@scope (.${scopeClass}) {\n${css}\n}</style>`
      )
      .join('\n');
  }
}

// Fixed-position elements are viewport overlays — logos, timers, tag bars,
// popups. Chrome prints them on every page, so hide them. Runs before
// `load`, ahead of the MathJax wait and page.pdf().
const PRINT_FIXUPS_SCRIPT = `<script>
(function () {
  var nodes = document.querySelectorAll('.card-content *');
  for (var i = 0; i < nodes.length; i++) {
    if (getComputedStyle(nodes[i]).position === 'fixed') {
      nodes[i].style.setProperty('display', 'none', 'important');
    }
  }
})();
</script>`;

function collectAllCards(
  previewService: ApkgPreviewService,
  parsed: ParsedApkg
): RenderedCard[] {
  const all: RenderedCard[] = [];
  let cursor = 0;
  const pageSize = 100;
  const mediaBaseUrl = '';
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const page = previewService.getCardsPage(
      parsed,
      cursor,
      pageSize,
      mediaBaseUrl,
      null,
      { print: true }
    );
    all.push(...page.cards);
    if (page.nextCursor == null) break;
    cursor = page.nextCursor;
  }
  return all;
}

const MATHJAX_CONFIG = String.raw`<script>
window.MathJax = {
  tex: { inlineMath: [['\\(','\\)'], ['$','$']], displayMath: [['\\[','\\]'], ['$$','$$']] },
  startup: { typeset: true }
};
</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" async></script>`;

function buildHtml(
  deckName: string,
  cards: RenderedCard[],
  assets: PdfAssets,
  backgroundColor: string
): string {
  const deckStyles = new DeckStyles();
  const rows = cards
    .map((card) =>
      buildCardRow(card, assets, deckStyles.scopeClassFor(card.css))
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(deckName)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; background:${backgroundColor}; }
  h1 { font-size: 18px; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th { text-align: left; font-size: 12px; padding: 6px 10px; border-bottom: 2px solid #333; }
  .card-cell { width: 50%; padding: 10px; border: 1px solid #ddd; vertical-align: top; word-wrap: break-word; overflow: hidden; }
  .card-content { font-size: 13px; line-height: 1.5; }
  .card-content img { max-width: 100%; height: auto; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
${deckStyles.toHtml()}
${MATHJAX_CONFIG}
</head>
<body>
<h1>${escapeHtml(deckName)}</h1>
<table>
<thead><tr><th>Front</th><th>Back</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${PRINT_FIXUPS_SCRIPT}
</body>
</html>`;
}

export type PaperSize = 'A4' | 'Letter' | 'Legal';
export type Orientation = 'portrait' | 'landscape';
export type Margins = 'narrow' | 'normal' | 'wide';

export interface PdfOptions {
  backgroundColor: string;
  paperSize: PaperSize;
  orientation: Orientation;
  margins: Margins;
}

export const DEFAULT_PDF_OPTIONS: PdfOptions = {
  backgroundColor: '#ffffff',
  paperSize: 'A4',
  orientation: 'portrait',
  margins: 'normal',
};

export interface ExportApkgToPdfResult {
  pdf: Buffer;
  deckName: string;
  cardCount: number;
}

export default class ExportApkgToPdfUseCase {
  constructor(
    private readonly previewService: ApkgPreviewService,
    private readonly pdfRenderService: PdfRenderService
  ) {}

  async execute(
    fileBuffer: Buffer,
    unlimitedAccess = false,
    options: PdfOptions = DEFAULT_PDF_OPTIONS
  ): Promise<ExportApkgToPdfResult> {
    const cacheKey = `pdf-export:${Date.now()}`;
    const parsed = await this.previewService.parse(cacheKey, fileBuffer);
    const meta = this.previewService.getMeta(parsed);

    if (!unlimitedAccess && meta.totalCards > MAX_CARDS) {
      throw new CardLimitExceededError(meta.totalCards);
    }

    const cards = collectAllCards(this.previewService, parsed);
    const deckName =
      meta.decks.length > 0 ? meta.decks[0].fullName : 'Flashcards';
    try {
      const pdf = await this.render(deckName, cards, parsed, options);
      return { pdf, deckName, cardCount: cards.length };
    } catch (error) {
      if (
        error instanceof PdfRenderCrashedError ||
        error instanceof PdfRenderTimeoutError
      ) {
        error.cardCount = cards.length;
      }
      throw error;
    }
  }

  private async render(
    deckName: string,
    cards: RenderedCard[],
    parsed: ParsedApkg,
    options: PdfOptions
  ): Promise<Buffer> {
    const assets = new PdfAssets(parsed);
    let html: string;
    try {
      html = buildHtml(deckName, cards, assets, options.backgroundColor);
    } catch (error) {
      // V8 caps a string at ~512 MiB; a deck that big can't be printed whole.
      if (error instanceof RangeError) throw new PdfRenderCrashedError(error);
      throw error;
    }
    return this.pdfRenderService.renderDocument(
      { html, assets: assets.files },
      options
    );
  }
}

export class CardLimitExceededError extends Error {
  constructor(public readonly cardCount: number) {
    super(
      `This deck has ${cardCount} cards. PDF export supports up to ${MAX_CARDS} cards.`
    );
    this.name = 'CardLimitExceededError';
  }
}

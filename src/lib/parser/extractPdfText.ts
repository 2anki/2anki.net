import pdfParse from 'pdf-parse';

export interface PdfPage {
  text: string;
  imagePaintCount: number;
}

export interface PdfExtractionResult {
  pages: PdfPage[];
  pageCount: number;
  avgCharsPerPage: number;
  isDrmLocked: boolean;
  needsCredential: boolean;
  coloredTextPageCount: number;
}

const DRM_CHARS_PER_PAGE_THRESHOLD = 10;
const PDFJS_BUILD = 'v1.10.100';

const RASTER_IMAGE_OPS = [
  'paintImageXObject',
  'paintJpegXObject',
  'paintInlineImageXObject',
  'paintInlineImageXObjectGroup',
  'paintImageXObjectRepeat',
];

// pdf.js normalizes every fill-colour operator (`g` gray, `k` CMYK, `cs`/`sc`
// colour space) into setFillRGBColor with 0-255 components before the operator
// list is produced, so tracking this one op is enough to see all text colour.
const FILL_RGB_OP = 'setFillRGBColor';
const TEXT_SHOW_OPS = [
  'showText',
  'showSpacedText',
  'nextLineShowText',
  'nextLineSetSpacingShowText',
];

// A grayscale fill (r≈g≈b: black, gray, white) renders as the card's default
// colour, so only a fill with real hue is colour a learner would miss. 24/255
// keeps rounding noise and near-neutral tints from firing a false notice.
const CHROMATIC_MIN_SPREAD = 24;

interface PdfJsOps {
  [opName: string]: number;
}

// pdf.js v1.10 VerbosityLevel: ERRORS = 0, WARNINGS = 1, INFOS = 5.
const PDFJS_VERBOSITY_ERRORS = 0;

interface PdfJsGlobalSettings {
  disableFontFace?: boolean;
  verbosity?: number;
}

interface PdfJsModule {
  OPS?: PdfJsOps;
  // pdf.js reads font settings from `globalScope.PDFJS`, re-exported here.
  PDFJS?: PdfJsGlobalSettings;
  disableFontFace?: boolean;
}

interface NodeImageStubLike {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
}

// pdf.js (v1.10) assumes a browser DOM. With no worker, its loopback transport
// reaches for two browser globals that don't exist in Node, throwing on every
// page that uses them — harmless to extraction, but it floods the error log:
//   - FontLoader binds web fonts via the `document` global. Fixed by setting
//     `disableFontFace` on the real settings object (`globalScope.PDFJS`), NOT
//     the top-level module — `getDefaultSetting` only reads the former.
//   - `loadJpegStream` decodes JPEG XObjects via `new Image()`. pdf-parse calls
//     `getDocument(buffer)` with no params, so `nativeImageDecoderSupport` can't
//     be set to skip that path. Instead we install a no-op `Image` stub: it
//     resolves the image object via `onload` (we never render, so the decoded
//     bytes are unused) without throwing or emitting pdf.js's own warn.
function installNodeImageGlobalShim(): void {
  if (typeof (globalThis as { Image?: unknown }).Image !== 'undefined') return;

  class NodeImageStub implements NodeImageStubLike {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private currentSrc = '';

    get src(): string {
      return this.currentSrc;
    }

    set src(value: string) {
      this.currentSrc = value;
      const handler = this.onload;
      if (typeof handler === 'function') {
        queueMicrotask(handler);
      }
    }
  }

  (globalThis as { Image?: unknown }).Image = NodeImageStub;
}

installNodeImageGlobalShim();

function loadPdfJs(): PdfJsModule | null {
  try {
    const pdfjs = require(
      `pdf-parse/lib/pdf.js/${PDFJS_BUILD}/build/pdf.js`
    ) as PdfJsModule;
    const settings: PdfJsGlobalSettings = pdfjs.PDFJS ?? pdfjs;
    settings.disableFontFace = true;
    // Silence benign per-page warnings ("Unimplemented annotation type
    // FreeText/Ink", "TT: undefined function") that pdf.js prints for ordinary
    // PDFs; they aren't actionable and flood the logs during conversion.
    settings.verbosity = PDFJS_VERBOSITY_ERRORS;
    return pdfjs;
  } catch {
    return null;
  }
}

interface PdfOperatorList {
  fnArray: number[];
  argsArray: unknown[];
}

interface PdfJsPageProxy {
  getTextContent(options: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }): Promise<{ items: Array<{ str: string; transform: number[] }> }>;
  getOperatorList(): Promise<PdfOperatorList>;
}

function resolveRasterImageOpcodes(): Set<number> {
  const opcodes = new Set<number>();
  const ops = loadPdfJs()?.OPS;
  if (ops == null) return opcodes;
  for (const name of RASTER_IMAGE_OPS) {
    const code = ops[name];
    if (typeof code === 'number') opcodes.add(code);
  }
  return opcodes;
}

interface ColorTextOpcodes {
  fillRgb: number | null;
  textShow: Set<number>;
}

function resolveColorTextOpcodes(): ColorTextOpcodes {
  const ops = loadPdfJs()?.OPS;
  if (ops == null) return { fillRgb: null, textShow: new Set() };
  const fillRgbCode = ops[FILL_RGB_OP];
  const textShow = new Set<number>();
  for (const name of TEXT_SHOW_OPS) {
    const code = ops[name];
    if (typeof code === 'number') textShow.add(code);
  }
  return {
    fillRgb: typeof fillRgbCode === 'number' ? fillRgbCode : null,
    textShow,
  };
}

const RASTER_IMAGE_OPCODES = resolveRasterImageOpcodes();
const COLOR_TEXT_OPCODES = resolveColorTextOpcodes();

export function isChromaticRgb(args: unknown): boolean {
  if (args == null || typeof args !== 'object') return false;
  const rgb = args as Record<number, unknown>;
  const r = rgb[0];
  const g = rgb[1];
  const b = rgb[2];
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') {
    return false;
  }
  return Math.max(r, g, b) - Math.min(r, g, b) > CHROMATIC_MIN_SPREAD;
}

async function getOperatorListSafe(
  page: PdfJsPageProxy
): Promise<PdfOperatorList | null> {
  try {
    return await page.getOperatorList();
  } catch {
    return null;
  }
}

function extractPageText(textContent: {
  items: Array<{ str: string; transform: number[] }>;
}): string {
  let lastY: number | undefined;
  let text = '';
  for (const item of textContent.items) {
    if (lastY === item.transform[5] || lastY == null) {
      text += item.str;
    } else {
      text += '\n' + item.str;
    }
    lastY = item.transform[5];
  }
  return text;
}

function countImagePaintOps(operatorList: PdfOperatorList | null): number {
  if (operatorList == null || RASTER_IMAGE_OPCODES.size === 0) return 0;
  return operatorList.fnArray.filter((code) => RASTER_IMAGE_OPCODES.has(code))
    .length;
}

// A text run only loses visible colour when a chromatic fill is active at the
// moment it is painted, so track the fill state and look at it on each
// text-show op. Fills applied to vector graphics never reach a text-show op, so
// a page of black text over coloured shapes does not count.
function pageHasColoredText(operatorList: PdfOperatorList | null): boolean {
  const { fillRgb, textShow } = COLOR_TEXT_OPCODES;
  if (operatorList == null || fillRgb == null || textShow.size === 0) {
    return false;
  }
  let chromatic = false;
  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const code = operatorList.fnArray[i];
    if (code === fillRgb) {
      chromatic = isChromaticRgb(operatorList.argsArray[i]);
    } else if (chromatic && textShow.has(code)) {
      return true;
    }
  }
  return false;
}

function splitIntoPages(
  fullText: string,
  pageCount: number,
  imageCounts: number[]
): PdfPage[] {
  const imageAt = (index: number) => imageCounts[index] ?? 0;

  if (!fullText.trim()) {
    return Array.from({ length: pageCount }, (_, i) => ({
      text: '',
      imagePaintCount: imageAt(i),
    }));
  }

  const chunks = fullText.split(/\f/).map((chunk) => chunk.trim());

  if (chunks.length >= pageCount) {
    return chunks
      .slice(0, pageCount)
      .map((text, i) => ({ text, imagePaintCount: imageAt(i) }));
  }

  const lines = fullText.split(/\n/);
  const linesPerPage = Math.ceil(lines.length / pageCount);
  return Array.from({ length: pageCount }, (_, i) => ({
    text: lines
      .slice(i * linesPerPage, (i + 1) * linesPerPage)
      .join('\n')
      .trim(),
    imagePaintCount: imageAt(i),
  }));
}

function isPasswordException(error: unknown): boolean {
  return error instanceof Error && error.name === 'PasswordException';
}

export async function extractPdfText(
  buffer: Buffer,
  credential?: string
): Promise<PdfExtractionResult> {
  const t0 = Date.now();

  const imageCounts: number[] = [];
  const coloredTextFlags: boolean[] = [];

  const pagerender = async (pageData: PdfJsPageProxy): Promise<string> => {
    const textContent = await pageData.getTextContent({
      normalizeWhitespace: false,
      disableCombineTextItems: false,
    });
    const operatorList = await getOperatorListSafe(pageData);
    imageCounts.push(countImagePaintOps(operatorList));
    coloredTextFlags.push(pageHasColoredText(operatorList));
    return extractPageText(textContent) + '\f';
  };

  const credentialOption =
    credential == null ? {} : { userPassword: credential };
  const options = {
    pagerender,
    version: PDFJS_BUILD,
    ...credentialOption,
  } as Parameters<typeof pdfParse>[1];

  let result;
  try {
    result = await pdfParse(buffer, options);
  } catch (error) {
    if (isPasswordException(error)) {
      console.info('[extractPdfText] password-protected PDF detected', {
        credentialProvided: credential != null,
        durationMs: Date.now() - t0,
      });
      return {
        pages: [],
        pageCount: 0,
        avgCharsPerPage: 0,
        isDrmLocked: false,
        needsCredential: true,
        coloredTextPageCount: 0,
      };
    }
    throw error;
  }

  const pageCount = result.numpages;
  const totalChars = result.text.length;
  const avgCharsPerPage = pageCount > 0 ? totalChars / pageCount : 0;
  const isDrmLocked = avgCharsPerPage < DRM_CHARS_PER_PAGE_THRESHOLD;
  const pages = isDrmLocked
    ? Array.from({ length: pageCount }, (_, i) => ({
        text: '',
        imagePaintCount: imageCounts[i] ?? 0,
      }))
    : splitIntoPages(result.text, pageCount, imageCounts);

  const pagesWithImage = pages.filter((p) => p.imagePaintCount > 0).length;
  const coloredTextPageCount = coloredTextFlags.filter(Boolean).length;

  console.info('[extractPdfText] result', {
    pageCount,
    avgCharsPerPage: Math.round(avgCharsPerPage),
    pagesWithImage,
    coloredTextPageCount,
    isDrmLocked,
    credentialProvided: credential != null,
    durationMs: Date.now() - t0,
  });

  return {
    pages,
    pageCount,
    avgCharsPerPage,
    isDrmLocked,
    needsCredential: false,
    coloredTextPageCount,
  };
}

import getDeckFilename from '../../../lib/anki/getDeckFilename';
import type { IssuedCardGuid } from '../../../lib/anki/guidLedgerTypes';
import {
  DeckParser,
  DeckParserInput,
  UploadIdentityContext,
  UploadIdentityStats,
} from '../../../lib/parser/DeckParser';
import Deck from '../../../lib/parser/Deck';
import {
  isCSVFile,
  isHTMLFile,
  isImageFile,
  isMarkdownFile,
  isPDFFile,
  isPPTFile,
  isXLSXFile,
  isDocxFile,
} from '../../../lib/storage/checks';
import { convertPDFToHTML } from './convertPDFToHTML';
import { convertPPTToPDF } from './ConvertPPTToPDF';
import { convertImageToHTML } from './convertImageToHTML';
import { convertPDFToImages } from './convertPDFToImages';
import {
  convertPdfTextToHtml,
  convertPdfTextToHtmlAuto,
  LoadPdfImages,
  PdfHtmlImage,
} from './convertPdfTextToHtml';
import { extractPdfImages } from '../../../lib/pdf/extractPdfImages';
import {
  AiCreditsExhaustedError,
  getAiBudgetStatus,
} from '../../../lib/claude/aiSpendGuard';
import { AI_CREDITS_EXHAUSTED_WARNING_CODE } from '../../../lib/claude/aiCredits/uploadWarning';
import { buildPdfPasswordSentinel } from '../../../lib/pdf/pdfPasswordSentinel';
import { convertXLSXToHTML } from './convertXLSXToHTML';
import { convertDocxToHTML } from './convertDocxToHTML';
import { createWorkspaceDocxImageMediaSink } from './docxImageMediaSink';
import {
  generateDeckInfo,
  AiCreditsTrippedWithSalvage,
  DeckInfo,
  CrossFileDedupState,
  createCrossFileDedupState,
  absorbFileIntoCrossFileDedup,
  buildTopUpInstruction,
} from '../../../lib/claude/ClaudeService';
import { getConversionResultCache } from '../../../data_layer/ConversionResultCacheRepository';
import {
  scoreCandidateDeck,
  type DeckScore,
} from '../../../lib/parser/scoreCandidateDeck';
import type { ConversionEngine } from '../../../lib/parser/conversionEngine';
import type { InducedRescue } from '../../../lib/parser/induction/candidateRules';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import Workspace from '../../../lib/parser/WorkSpace';
import path from 'path';
import {
  logFileLabel,
  summarizeFileNames,
} from '../../../lib/logging/logFileLabel';
import { writeWorkspaceFile } from './writeWorkspaceFile';
import { writePdfImageFallbackMarker } from './pdfImageFallbackMarker';
import { mediaFilesForHtmlFile } from './mediaFilesForHtmlFile';

const HTML_GENERATION_CONCURRENCY = 3;

// Bound how many files convert at once. An unbounded Promise.all over a
// large image/PDF deck holds every converter's working memory (base64 copies,
// pdf→image buffers) resident simultaneously, which is a heap-OOM path on a big
// upload (#3709). Order is preserved by mapWithConcurrency's indexed writes.
const FILE_CONVERSION_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runnerCount = Math.min(concurrency, items.length);
  const runners = new Array(runnerCount).fill(null).map(async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// Upload card identity only applies to formats whose card fronts are stable
// enough to key on: markdown, plain HTML, CSV and xlsx. PDF text extraction and
// AI-generated fronts are non-deterministic, and Notion exports keep the
// block-id path, so those never opt in. Absence of the context is the safe
// default — the parser skips the whole path.
function eligibleUploadIdentity(
  input: DeckParserInput
): UploadIdentityContext | undefined {
  if (input.uploadIdentity == null) {
    return undefined;
  }
  const name = input.name;
  const eligible =
    isMarkdownFile(name) ||
    isHTMLFile(name) ||
    isXLSXFile(name) ||
    Boolean(isCSVFile(name));
  return eligible ? input.uploadIdentity : undefined;
}

function newDeckParser(
  input: DeckParserInput,
  allFiles: DeckParserInput['files']
): DeckParser {
  return new DeckParser({
    ...input,
    files: allFiles,
    uploadIdentity: eligibleUploadIdentity(input),
  });
}

// The parser always holds a zeroed stats object; only surface it when the
// identity path actually ran, so a signed-in PDF or Notion export upload does
// not emit a noisy all-zero upload_identity_replayed event.
function uploadIdentityStatsFor(
  input: DeckParserInput,
  parser: DeckParser
): UploadIdentityStats | undefined {
  return eligibleUploadIdentity(input) == null
    ? undefined
    : parser.uploadIdentityStats;
}

function dedupeFilesByName(
  files: DeckParserInput['files']
): DeckParserInput['files'] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.name)) return false;
    seen.add(file.name);
    return true;
  });
}

interface PrepareDeckResult {
  name: string;
  apkg: Buffer;
  deck: Deck[];
  cardCount: number;
  mcqCount: number;
  mcqSkippedCount: number;
  warning?: string;
  droppedImageCount: number;
  expiredNotionImageCount: number;
  emptyBackCount: number;
  parsePath?: string;
  engine?: ConversionEngine;
  score?: DeckScore;
  inducedRule?: InducedRescue;
  guidEntries?: IssuedCardGuid[];
  uploadIdentityStats?: UploadIdentityStats;
}

// A rejected rescue must not ride a deck that still shipped through a later
// stage (the fallback parser). When cards shipped, the induction is not what
// produced them, so the row records as a normal shipped deck; the rejected
// rescue only travels when the deck it judged is the one that ships (empty).
function shippedInducedRule(
  induced: InducedRescue | undefined,
  cardCount: number
): InducedRescue | undefined {
  if (induced?.outcome === 'rescue_rejected' && cardCount > 0) {
    return undefined;
  }
  return induced;
}

// One coded warning per deck; UploadService turns the code into copy. The
// markdown heuristic outranks stray cloze markup because it questions the
// whole deck, not a handful of cards.
export function parserWarning(parser: {
  usedHeuristic: boolean;
  strayClozeCount: number;
}): string | undefined {
  if (parser.usedHeuristic) return 'markdown-heuristic';
  if (parser.strayClozeCount > 0)
    return `stray-cloze:${parser.strayClozeCount}`;
  return undefined;
}

// Shared across a single upload's file conversions. `exhausted` is the
// start-of-conversion pre-check verdict (at zero → skip the AI vision branches
// from the start); `tripped` is set when the always-on per-call guard fires
// mid-run so the caller attaches the credits warning. Both drive the same
// warning code — the deck ships, the job never fails.
interface AiConversionState {
  exhausted: boolean;
  tripped: boolean;
}

// A mid-run guard trip inside a vision/quiz conversion skips that file and flags
// the credits warning rather than failing the whole upload; any other error
// propagates.
async function runVisionConversion(
  ai: AiConversionState,
  produce: () => Promise<ConvertedFile>
): Promise<ConvertedFile | null> {
  try {
    return await produce();
  } catch (error) {
    if (error instanceof AiCreditsExhaustedError) {
      ai.tripped = true;
      return null;
    }
    throw error;
  }
}

// The start-of-conversion pre-check decided the early fallback: when exhausted,
// the AI vision branches are skipped and the file goes to the standard parser.
// The per-call guard inside every Claude call is never disabled, so a mid-job
// balance dip trips it; the vision/quiz branches catch that, skip the file, and
// flag the credits warning rather than failing the whole conversion.
async function convertFile(
  file: DeckParserInput['files'][number],
  input: DeckParserInput,
  ai: AiConversionState
): Promise<ConvertedFile | null> {
  if (!file.contents) return null;

  console.info('[PrepareDeck] convertFile start', {
    file: logFileLabel(file.name),
    workspaceLocation: input.workspace.location,
  });

  const t0 = Date.now();

  if (isXLSXFile(file.name)) {
    const result = {
      name: `${file.name}.html`,
      contents: Buffer.from(
        convertXLSXToHTML(file.contents as Buffer, file.name)
      ),
    };
    console.log('[PrepareDeck] convertFile xlsx', {
      file: file.name,
      durationMs: Date.now() - t0,
    });
    return result;
  }

  if (isDocxFile(file.name)) {
    const mediaSink = createWorkspaceDocxImageMediaSink(
      input.workspace.location
    );
    // Record what the sink writes: the flat hash-named images never match the
    // <html-base>/ media convention, so without carrying them as extraFiles
    // the AI branch converts DOCX text without its images (#3946).
    const writtenImages: PdfHtmlImage[] = [];
    const recordingSink: typeof mediaSink = {
      write(bytes, contentType) {
        const fileName = mediaSink.write(bytes, contentType);
        writtenImages.push({ name: fileName, contents: bytes });
        return fileName;
      },
    };
    const result = {
      name: `${file.name}.html`,
      contents: Buffer.from(
        await convertDocxToHTML(file.contents as Buffer, recordingSink, {
          bulletFanOut: input.settings.overlappingCloze === 'off',
        })
      ),
      extraFiles: writtenImages.length > 0 ? writtenImages : undefined,
    };
    console.log('[PrepareDeck] convertFile docx', {
      file: file.name,
      imageCount: writtenImages.length,
      durationMs: Date.now() - t0,
    });
    return result;
  }

  if (
    isImageFile(file.name) &&
    input.settings.imageQuizHtmlToAnki &&
    input.noLimits &&
    !ai.exhausted
  ) {
    return runVisionConversion(ai, async () => {
      const result = {
        name: `${file.name}.html`,
        contents: await convertImageToHTML(
          (file.contents as Buffer).toString('base64'),
          input.userId ?? null
        ),
      };
      console.log('[PrepareDeck] convertFile image', {
        file: file.name,
        durationMs: Date.now() - t0,
      });
      return result;
    });
  }

  if (!isPDFFile(file.name) && !isPPTFile(file.name)) return null;

  if (
    isPDFFile(file.name) &&
    input.noLimits &&
    input.settings.vertexAIPDFQuestions &&
    input.settings.processPDFs !== false &&
    !ai.exhausted
  ) {
    return runVisionConversion(ai, async () => {
      const result = {
        name: `${file.name}.html`,
        contents: Buffer.from(
          await convertPDFToHTML(
            (file.contents as Buffer).toString('base64'),
            input.settings.userInstructions,
            input.userId ?? null
          )
        ),
      };
      console.log('[PrepareDeck] convertFile pdf→html (vertex)', {
        file: file.name,
        durationMs: Date.now() - t0,
      });
      return result;
    });
  }

  if (isPPTFile(file.name)) {
    const pdContents = await convertPPTToPDF(
      file.name,
      file.contents as Buffer,
      input.workspace
    );
    const result: ConvertedFile = {
      name: `${file.name}.html`,
      contents: Buffer.from(
        await convertPDFToImages({
          name: file.name,
          workspace: input.workspace,
          noLimits: input.noLimits,
          contents: pdContents,
          settings: input.settings,
        })
      ),
      imageFallback: true,
    };
    console.log('[PrepareDeck] convertFile ppt→pdf→images', {
      file: file.name,
      durationMs: Date.now() - t0,
    });
    return result;
  }

  if (isPDFFile(file.name) && input.settings.processPDFs !== false) {
    if (input.settings.pdfPagePairs) {
      return convertPdfByPagePairs(file, input, t0);
    }
    if (input.settings.pdfExtractText) {
      return convertPdfByManualTextFlag(file, input, t0);
    }
    return convertPdfByAutoDetection(file, input, t0);
  }

  return null;
}

interface ConvertedFile {
  name: string;
  contents: Buffer | string;
  size?: number;
  imageFallback?: boolean;
  droppedImageCount?: number;
  extraFiles?: PdfHtmlImage[];
}

// Embedded-figure extraction is opt-out via the same embed-images CardOption
// that governs every other image path; the loader is handed to the converter
// so only a committed text-path conversion pays for the pdfimages run.
function pdfImageLoader(
  file: DeckParserInput['files'][number],
  input: DeckParserInput
): LoadPdfImages | undefined {
  if (!input.settings.embedImages) return undefined;
  return () => extractPdfImages(file.contents as Buffer);
}

async function convertPdfPagesToImagesFile(
  file: DeckParserInput['files'][number],
  input: DeckParserInput
): Promise<ConvertedFile> {
  const html = await convertPDFToImages({
    name: file.name,
    workspace: input.workspace,
    noLimits: input.noLimits,
    contents: file.contents as Buffer,
    settings: input.settings,
  });
  return {
    name: `${file.name}.html`,
    contents: Buffer.from(html),
    imageFallback: true,
    droppedImageCount: input.settings.embedImages
      ? 0
      : (html.match(/<img /g) ?? []).length,
  };
}

async function convertPdfByPagePairs(
  file: DeckParserInput['files'][number],
  input: DeckParserInput,
  t0: number
) {
  console.log('[PrepareDeck] convertFile pdf→images (page-pairs opt-in)', {
    file: file.name,
    durationMs: Date.now() - t0,
  });
  return convertPdfPagesToImagesFile(file, input);
}

async function convertPdfByManualTextFlag(
  file: DeckParserInput['files'][number],
  input: DeckParserInput,
  t0: number
) {
  const textResult = await convertPdfTextToHtml(
    file.contents as Buffer,
    file.name,
    input.pdfCredential,
    pdfImageLoader(file, input)
  );

  if (textResult.needsCredential) {
    throw new Error(buildPdfPasswordSentinel(file.name));
  }

  if (!textResult.isDrmLocked && textResult.cardCount > 0) {
    console.log('[PrepareDeck] convertFile pdf→text→html', {
      file: file.name,
      cardCount: textResult.cardCount,
      durationMs: Date.now() - t0,
    });
    return {
      name: `${file.name}.html`,
      contents: Buffer.from(textResult.html),
      droppedImageCount: textResult.droppedImageCount,
      extraFiles: textResult.images,
    };
  }

  console.log('[PrepareDeck] convertFile pdf→images (text fallback)', {
    file: file.name,
    isDrmLocked: textResult.isDrmLocked,
    cardCount: textResult.cardCount,
    durationMs: Date.now() - t0,
  });
  return convertPdfPagesToImagesFile(file, input);
}

async function convertPdfByAutoDetection(
  file: DeckParserInput['files'][number],
  input: DeckParserInput,
  t0: number
) {
  const autoResult = await convertPdfTextToHtmlAuto(
    file.contents as Buffer,
    file.name,
    input.pdfCredential,
    pdfImageLoader(file, input)
  );

  if (autoResult.needsCredential) {
    throw new Error(buildPdfPasswordSentinel(file.name));
  }

  const cardsPerPage =
    Math.round(
      (autoResult.cardCount / Math.max(autoResult.pageCount, 1)) * 10
    ) / 10;

  if (
    autoResult.isTextShaped &&
    autoResult.cardCount > 0 &&
    !autoResult.overSplit
  ) {
    console.log('[PrepareDeck] convertFile pdf→text→html (auto)', {
      file: file.name,
      cardCount: autoResult.cardCount,
      pageCount: autoResult.pageCount,
      cardsPerPage,
      durationMs: Date.now() - t0,
    });
    return {
      name: `${file.name}.html`,
      contents: Buffer.from(autoResult.html),
      droppedImageCount: autoResult.droppedImageCount,
      extraFiles: autoResult.images,
    };
  }

  console.log('[PrepareDeck] convertFile pdf→images (auto fallback)', {
    file: file.name,
    isTextShaped: autoResult.isTextShaped,
    isDrmLocked: autoResult.isDrmLocked,
    overSplit: autoResult.overSplit,
    cardCount: autoResult.cardCount,
    pageCount: autoResult.pageCount,
    cardsPerPage,
    durationMs: Date.now() - t0,
  });
  return convertPdfPagesToImagesFile(file, input);
}

// Both build paths must hand the parser the same file set: the originals, the
// converted HTML, and any figure images the converters extracted (extraFiles).
// The batched zip path once dropped the extracted images, so PDF figures went
// missing from decks only when the upload was large enough to batch (#4054).
export function assembleParserFiles(
  files: DeckParserInput['files'],
  convertedFiles: ConvertedFile[]
): DeckParserInput['files'] {
  const extractedImages = convertedFiles.flatMap((f) => f.extraFiles ?? []);
  return [...files, ...convertedFiles, ...extractedImages];
}

function deckPrefixFromFilePath(htmlFileName: string): string {
  const normalized = htmlFileName.replaceAll('\\', '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash < 0) return '';
  const dirParts = normalized.substring(0, lastSlash).split('/');
  return dirParts
    .map((p) => p.replace(/ [a-f0-9]{32}$/i, '').trim())
    .filter(Boolean)
    .join('::');
}

function composeCrossFileInstructions(
  priorFronts: string[],
  userInstructions: string | undefined,
  cardSize: string | undefined
): string | undefined {
  if (priorFronts.length === 0) return userInstructions;
  const topUp = buildTopUpInstruction(priorFronts, cardSize);
  return userInstructions ? `${userInstructions}\n\n${topUp}` : topUp;
}

interface ClaudeConversionResult {
  deckInfoArrays: DeckInfo[][];
  crossFileDedup: CrossFileDedupState | undefined;
  ownsDedup: boolean;
  // The credit guard tripped mid-run; the caller ships the cards produced so
  // far and attaches the credits warning.
  tripped: boolean;
}

// The per-call guard can trip mid-run when a concurrent conversion drains the
// balance. When it does, stop issuing Claude calls and ship the cards produced
// so far — the deck carries a credits warning and the job never fails. There is
// no standard-parser recovery of the untouched files: a partial AI deck with a
// warning beats mixing two engines' output in one deck.
function salvagedDecksOf(error: AiCreditsExhaustedError): DeckInfo[] {
  return error instanceof AiCreditsTrippedWithSalvage
    ? error.salvagedDecks
    : [];
}

async function runCrossFileDedupConversion(
  htmlFiles: DeckParserInput['files'],
  generateForFile: (
    file: DeckParserInput['files'][number],
    instructions?: string
  ) => Promise<DeckInfo[]>,
  userInstructions: string | undefined,
  cardSize: string | undefined,
  crossFileDedup: CrossFileDedupState
): Promise<{ deckInfoArrays: DeckInfo[][]; tripped: boolean }> {
  const deckInfoArrays: DeckInfo[][] = [];
  let tripped = false;
  for (const file of htmlFiles) {
    if (tripped) break;
    const instructions = composeCrossFileInstructions(
      crossFileDedup.fronts,
      userInstructions,
      cardSize
    );
    try {
      const decks = await generateForFile(file, instructions);
      deckInfoArrays.push(absorbFileIntoCrossFileDedup(crossFileDedup, decks));
    } catch (error) {
      if (error instanceof AiCreditsExhaustedError) {
        deckInfoArrays.push(
          absorbFileIntoCrossFileDedup(crossFileDedup, salvagedDecksOf(error))
        );
        tripped = true;
        break;
      }
      throw error;
    }
  }
  return { deckInfoArrays, tripped };
}

async function runConcurrentClaudeConversion(
  htmlFiles: DeckParserInput['files'],
  generateForFile: (
    file: DeckParserInput['files'][number],
    instructions?: string
  ) => Promise<DeckInfo[]>,
  userInstructions: string | undefined
): Promise<{ deckInfoArrays: DeckInfo[][]; tripped: boolean }> {
  let tripped = false;
  const perFile = await mapWithConcurrency(
    htmlFiles,
    HTML_GENERATION_CONCURRENCY,
    async (file) => {
      if (tripped) {
        return [] as DeckInfo[];
      }
      try {
        return await generateForFile(file, userInstructions);
      } catch (error) {
        if (error instanceof AiCreditsExhaustedError) {
          tripped = true;
          return salvagedDecksOf(error);
        }
        throw error;
      }
    }
  );
  return { deckInfoArrays: perFile, tripped };
}

async function runClaudeConversion(
  htmlFiles: DeckParserInput['files'],
  generateForFile: (
    file: DeckParserInput['files'][number],
    instructions?: string
  ) => Promise<DeckInfo[]>,
  userInstructions: string | undefined,
  cardSize: string | undefined,
  threadedDedup: CrossFileDedupState | undefined
): Promise<ClaudeConversionResult> {
  const ownsDedup = threadedDedup == null && htmlFiles.length >= 2;
  const crossFileDedup =
    threadedDedup ?? (ownsDedup ? createCrossFileDedupState() : undefined);

  const { deckInfoArrays, tripped } = crossFileDedup
    ? await runCrossFileDedupConversion(
        htmlFiles,
        generateForFile,
        userInstructions,
        cardSize,
        crossFileDedup
      )
    : await runConcurrentClaudeConversion(
        htmlFiles,
        generateForFile,
        userInstructions
      );

  return { deckInfoArrays, crossFileDedup, ownsDedup, tripped };
}

function emitCrossFileConversionEvent(
  userId: number | null,
  state: CrossFileDedupState
): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { track } = require('../../../services/events/track');
  track('ai_conversion_completed', {
    userId,
    props: {
      source_file_count: state.filesProcessed,
      cross_file_duplicates_suppressed: state.suppressed,
    },
  });
}

// The standard-parser build, shared by the non-AI branch and the AI branch's
// zero-card fallback. Any aiWarning (an at-zero pre-check or a mid-run trip)
// rides along so the user still learns the deck was built without AI.
async function buildParserResult(
  input: DeckParserInput,
  allFiles: DeckParserInput['files'],
  convertedFiles: ConvertedFile[],
  aiWarning: string | undefined
): Promise<PrepareDeckResult> {
  const parser = newDeckParser(input, allFiles);

  if (parser.totalCardCount() === 0) {
    if (convertedFiles.length > 0) {
      const htmlFile = convertedFiles.find((file) => isHTMLFile(file.name));
      parser.processFirstFile(htmlFile?.name ?? input.name);
    } else {
      const apkg = await parser.tryExperimental();
      return {
        name: getDeckFilename(parser.name ?? input.name),
        apkg,
        deck: parser.payload,
        cardCount: parser.totalCardCount(),
        mcqCount: 0,
        mcqSkippedCount: 0,
        warning: aiWarning ?? parserWarning(parser),
        droppedImageCount: parser.droppedImageCount,
        expiredNotionImageCount: parser.expiredNotionImageCount,
        emptyBackCount: parser.emptyBackCount,
        // This is the branch a document takes when nothing recognised it, so it
        // is exactly the population a rescue has to clear. Without a score here
        // the corpus is made only of successes, and a floor calibrated on
        // successes cannot judge a failure.
        engine: 'parser',
        score: scoreCandidateDeck(
          parser.payload.flatMap((deck) => deck.cards),
          allFiles.reduce(
            (sum, f) => sum + (f.size ?? f.contents?.length ?? 0),
            0
          )
        ),
        inducedRule: shippedInducedRule(
          parser.inducedRule,
          parser.totalCardCount()
        ),
        guidEntries: parser.issuedGuidEntries,
        uploadIdentityStats: uploadIdentityStatsFor(input, parser),
      };
    }
  }

  const mcqCount = parser.payload.reduce((sum, d) => sum + d.mcqCount, 0);
  const mcqSkippedCount = parser.payload.reduce(
    (sum, d) => sum + d.mcqSkippedCount,
    0
  );
  const apkg = await parser.build(input.workspace);
  return {
    name: getDeckFilename(parser.name),
    apkg,
    deck: parser.payload,
    cardCount: parser.totalCardCount(),
    mcqCount,
    mcqSkippedCount,
    warning: aiWarning ?? parserWarning(parser),
    droppedImageCount: parser.droppedImageCount,
    expiredNotionImageCount: parser.expiredNotionImageCount,
    emptyBackCount: parser.emptyBackCount,
    parsePath: parser.parsePathSignature(),
    engine: 'parser',
    score: scoreCandidateDeck(
      parser.payload.flatMap((deck) => deck.cards),
      allFiles.reduce((sum, f) => sum + (f.size ?? f.contents?.length ?? 0), 0)
    ),
    inducedRule: shippedInducedRule(
      parser.inducedRule,
      parser.totalCardCount()
    ),
    guidEntries: parser.issuedGuidEntries,
    uploadIdentityStats: uploadIdentityStatsFor(input, parser),
  };
}

async function buildClaudeDeck(
  input: DeckParserInput,
  allFiles: DeckParserInput['files'],
  convertedFiles: ConvertedFile[],
  pdfImageFallbackNames: Set<string>,
  tTotal: number
): Promise<PrepareDeckResult | undefined> {
  console.log('[PrepareDeck] Claude branch: collecting HTML content');
  const htmlFiles = allFiles.filter(
    (f) => (isHTMLFile(f.name) || isMarkdownFile(f.name)) && f.contents
  );

  // Figure images extracted per source file (PDF text-layer, DOCX) travel
  // to their own HTML via pdfFigureNamesByHtml below; keeping them out of
  // the shared pool stops the unclaimed-media fallback from offering one
  // file's figures to every other file's prompt.
  const perFileFigureNames = new Set(
    convertedFiles.flatMap(
      (f) => f.extraFiles?.map((image) => image.name) ?? []
    )
  );
  const mediaFiles = allFiles
    .filter(
      (f) =>
        !isHTMLFile(f.name) &&
        !isMarkdownFile(f.name) &&
        !perFileFigureNames.has(f.name)
    )
    .map((f) => f.name);

  const pdfFigureNamesByHtml = new Map(
    convertedFiles
      .filter((f) => (f.extraFiles?.length ?? 0) > 0)
      .map((f) => [f.name, f.extraFiles!.map((image) => image.name)])
  );

  const tWrite = Date.now();
  await Promise.all(
    allFiles
      .filter((file) => file.contents)
      .map((file) =>
        writeWorkspaceFile(input.workspace.location, {
          name: file.name,
          contents: file.contents,
        })
      )
  );
  console.log('[PrepareDeck] Claude branch: files written', {
    durationMs: Date.now() - tWrite,
  });

  writePdfImageFallbackMarker(input.workspace.location, [
    ...pdfImageFallbackNames,
  ]);

  const userInstructions = input.settings.userInstructions;
  const cardStyle = input.settings.cardStyle || undefined;
  const fieldMapping = input.settings.fieldMapping;
  console.log('[PrepareDeck] Claude branch: calling generateDeckInfo', {
    htmlFileCount: htmlFiles.length,
    mediaFilesCount: mediaFiles.length,
    hasUserInstructions: !!userInstructions?.trim(),
    cardStyle,
    hasFieldMapping: fieldMapping != null,
  });
  const tClaude = Date.now();
  const baseGenerateDeckInfoOptions = {
    isPaying: input.noLimits,
    userId: input.userId ?? null,
    requestId: input.requestId,
    comprehensive: input.settings.aiComprehensive,
    conversionResultCache: getConversionResultCache(),
  };
  const optionsForFile = (f: (typeof htmlFiles)[number]) =>
    pdfImageFallbackNames.has(f.name)
      ? {
          ...baseGenerateDeckInfoOptions,
          pdfImageFallback: {
            mediaBaseDir: input.workspace.location,
            attachPageImages: input.settings.embedImages,
          },
        }
      : baseGenerateDeckInfoOptions;
  const generateForFile = (
    f: (typeof htmlFiles)[number],
    instructions?: string
  ) =>
    generateDeckInfo(
      f.contents!.toString(),
      [
        ...mediaFilesForHtmlFile(
          f.name,
          mediaFiles,
          htmlFiles.map((h) => h.name)
        ),
        ...(pdfFigureNamesByHtml.get(f.name) ?? []),
      ],
      instructions,
      input.onProgress,
      cardStyle,
      input.settings.cardSize,
      fieldMapping,
      optionsForFile(f)
    );

  const { deckInfoArrays, crossFileDedup, ownsDedup, tripped } =
    await runClaudeConversion(
      htmlFiles,
      generateForFile,
      userInstructions,
      input.settings.cardSize,
      input.crossFileDedup
    );

  if (ownsDedup && crossFileDedup) {
    emitCrossFileConversionEvent(input.userId ?? null, crossFileDedup);
  }

  const aiDecks = deckInfoArrays.flatMap((decks, i) => {
    const prefix = deckPrefixFromFilePath(htmlFiles[i].name);
    return decks
      .filter((d) => d.cards.length > 0)
      .map((d) => ({
        ...d,
        name: prefix ? `${prefix}::${d.name}` : d.name,
      }));
  });

  // The credit guard tripped mid-run: ship the cards produced so far and flag
  // the credits warning. No standard-parser recovery of the untouched files —
  // a partial AI deck with a warning beats mixing engines in one deck.
  const creditsWarning = tripped
    ? AI_CREDITS_EXHAUSTED_WARNING_CODE
    : undefined;
  if (tripped) {
    console.info(
      '[PrepareDeck] Claude branch: credit guard tripped, shipping produced cards'
    );
  }

  const deckInfo = aiDecks as unknown as Deck[];
  console.log('[PrepareDeck] Claude branch: generateDeckInfo done', {
    durationMs: Date.now() - tClaude,
    htmlFilesProcessed: htmlFiles.length,
    totalDecks: deckInfo.length,
    totalCards: deckInfo.reduce((sum, d) => sum + d.cards.length, 0),
  });

  // An empty AI deck must never reach the Python exporter — a zero-card deck
  // throws PythonZeroCardsError and fails the whole upload.
  if (deckInfo.length === 0) {
    // In a multi-file upload a later file whose cards were all covered by
    // earlier files has nothing of its own to export; drop it and let the
    // earlier files carry the upload.
    if (crossFileDedup && !tripped) {
      console.info(
        '[PrepareDeck] Claude branch: file fully covered by earlier files',
        {
          suppressed: crossFileDedup.suppressed,
          filesProcessed: crossFileDedup.filesProcessed,
        }
      );
      return undefined;
    }
    // A single-file upload whose only chunk tripped mid-run (or an AI pass that
    // produced nothing) falls back to the standard parser and carries the
    // credits warning, so the upload degrades gracefully instead of crashing.
    console.info('[PrepareDeck] Claude branch: no AI cards, parser fallback', {
      tripped,
    });
    return buildParserResult(input, allFiles, convertedFiles, creditsWarning);
  }

  const deckName =
    deckInfo.length === 1
      ? deckInfo[0].name
      : (input.name ?? deckInfo[0]?.name ?? 'Untitled Deck');
  const exporter = new CustomExporter(deckName, input.workspace.location);
  exporter.configure(deckInfo);
  const tExport = Date.now();
  const apkg = await exporter.save();
  const claudeCardCount = deckInfo.reduce((sum, d) => sum + d.cards.length, 0);
  console.log('[PrepareDeck] Claude branch: exporter.save done', {
    durationMs: Date.now() - tExport,
  });
  console.log('[PrepareDeck] done (Claude path)', {
    totalMs: Date.now() - tTotal,
  });
  return {
    name: getDeckFilename(deckName),
    apkg,
    deck: [],
    cardCount: claudeCardCount,
    warning: creditsWarning,
    // The Claude branch returns deck: [], so a caller that scores from `deck`
    // measures nothing on every AI conversion. Scored here, where the cards
    // still exist.
    engine: 'claude',
    score: scoreCandidateDeck(
      deckInfo.flatMap((d) => d.cards),
      htmlFiles.reduce((sum, f) => sum + (f.size ?? f.contents?.length ?? 0), 0)
    ),
    mcqCount: 0,
    mcqSkippedCount: 0,
    droppedImageCount: convertedFiles.reduce(
      (sum, f) => sum + (f.droppedImageCount ?? 0),
      0
    ),
    expiredNotionImageCount: 0,
    emptyBackCount: 0,
  };
}

// Whether this upload's actual files will reach Claude, not merely whether an
// AI toggle is persisted on the account. claudeAIFlashcards routes every file
// through the AI branch; the vision toggles only reach Claude when a matching
// file type is present. Gating the pre-check on this keeps a plain
// markdown/HTML upload from getting a false "built without AI" credits notice
// when a PDF/image toggle happens to be left on.
export function conversionInvokesAi(
  settings: DeckParserInput['settings'],
  files: DeckParserInput['files']
): boolean {
  if (settings.claudeAIFlashcards) {
    return true;
  }
  if (
    settings.imageQuizHtmlToAnki &&
    files.some((file) => isImageFile(file.name))
  ) {
    return true;
  }
  if (
    settings.vertexAIPDFQuestions &&
    settings.processPDFs !== false &&
    files.some((file) => isPDFFile(file.name))
  ) {
    return true;
  }
  return false;
}

interface ResolvedAiGate {
  exhausted: boolean;
  warning?: string;
}

// The start-of-conversion pre-check is one question: is the balance already at
// zero for a conversion that will actually invoke Claude. If so the deck builds
// with the standard parser and carries the credits warning; otherwise the
// conversion proceeds and the always-on per-call guard catches any mid-run dip.
// No cost estimate — the guard is the safety net.
async function resolveAiConversionGate(
  input: DeckParserInput,
  files: DeckParserInput['files']
): Promise<ResolvedAiGate> {
  const willInvokeAi =
    input.noLimits && conversionInvokesAi(input.settings, files);
  if (willInvokeAi) {
    const status = await getAiBudgetStatus(input.userId ?? null);
    if (status.exhausted) {
      return { exhausted: true, warning: AI_CREDITS_EXHAUSTED_WARNING_CODE };
    }
  }
  return { exhausted: false };
}

export async function PrepareDeck(
  input: DeckParserInput
): Promise<PrepareDeckResult | undefined> {
  const tTotal = Date.now();

  const files = dedupeFilesByName(input.files);

  const fileSummary = summarizeFileNames(files.map((f) => f.name));
  console.info('[PrepareDeck] received', fileSummary);

  console.log('[PrepareDeck] start', {
    name: logFileLabel(input.name),
    fileCount: files.length,
    claudeEnabled: input.settings.claudeAIFlashcards,
    noLimits: input.noLimits,
  });

  const aiGate = await resolveAiConversionGate(input, files);
  const aiCreditsExhausted = aiGate.exhausted;
  if (aiCreditsExhausted) {
    console.info('[PrepareDeck] AI credits exhausted, building without AI', {
      name: logFileLabel(input.name),
    });
  }
  const ai: AiConversionState = {
    exhausted: aiCreditsExhausted,
    tripped: false,
  };

  const tConvert = Date.now();
  const results = await mapWithConcurrency(
    files,
    FILE_CONVERSION_CONCURRENCY,
    (file) => convertFile(file, input, ai)
  );
  const convertedFiles = results.flatMap((r) => (r ? [r] : []));
  console.log('[PrepareDeck] file conversions done', {
    convertedCount: convertedFiles.length,
    durationMs: Date.now() - tConvert,
  });

  const pdfImageFallbackNames = new Set(
    convertedFiles.filter((f) => f.imageFallback).map((f) => f.name)
  );

  const allFiles = assembleParserFiles(files, convertedFiles);

  if (
    input.settings.claudeAIFlashcards &&
    input.noLimits &&
    !aiCreditsExhausted
  ) {
    return buildClaudeDeck(
      input,
      allFiles,
      convertedFiles,
      pdfImageFallbackNames,
      tTotal
    );
  }

  // At-zero pre-check or a mid-run vision-branch trip both fall back to the
  // parser carrying the credits warning.
  const aiWarning =
    aiGate.warning ??
    (ai.tripped ? AI_CREDITS_EXHAUSTED_WARNING_CODE : undefined);

  return buildParserResult(input, allFiles, convertedFiles, aiWarning);
}

export interface DeckInfoOnlyResult {
  deckInfoPath: string;
  outputPath: string;
  name: string;
  inputFileName: string;
  deck: Deck[];
  cardCount: number;
  mcqCount: number;
  mcqSkippedCount: number;
  warning?: string;
  droppedImageCount: number;
  expiredNotionImageCount: number;
  emptyBackCount: number;
  parsePath?: string;
  engine?: ConversionEngine;
  score?: DeckScore;
  inducedRule?: InducedRescue;
  guidEntries?: IssuedCardGuid[];
  uploadIdentityStats?: UploadIdentityStats;
  needsIndividualBuild: boolean;
}

export async function prepareDeckInfoOnly(
  input: DeckParserInput,
  deckSubWorkspace: Workspace,
  outputWorkspace: Workspace
): Promise<DeckInfoOnlyResult> {
  const files = dedupeFilesByName(input.files);
  const aiGate = await resolveAiConversionGate(input, files);
  const ai: AiConversionState = {
    exhausted: aiGate.exhausted,
    tripped: false,
  };
  const results = await mapWithConcurrency(
    files,
    FILE_CONVERSION_CONCURRENCY,
    (file) => convertFile(file, input, ai)
  );
  const convertedFiles = results.flatMap((r) => (r ? [r] : []));
  const allFiles = assembleParserFiles(files, convertedFiles);
  const aiWarning =
    aiGate.warning ??
    (ai.tripped ? AI_CREDITS_EXHAUSTED_WARNING_CODE : undefined);

  const parser = newDeckParser(input, allFiles);

  if (parser.totalCardCount() === 0) {
    if (convertedFiles.length > 0) {
      const htmlFile = convertedFiles.find((file) => isHTMLFile(file.name));
      parser.processFirstFile(htmlFile?.name ?? input.name);
    } else {
      return {
        deckInfoPath: '',
        outputPath: '',
        name: getDeckFilename(parser.name ?? input.name),
        inputFileName: input.name,
        deck: parser.payload,
        cardCount: 0,
        mcqCount: 0,
        mcqSkippedCount: 0,
        warning: aiWarning ?? parserWarning(parser),
        droppedImageCount: parser.droppedImageCount,
        expiredNotionImageCount: parser.expiredNotionImageCount,
        emptyBackCount: parser.emptyBackCount,
        needsIndividualBuild: true,
      };
    }
  }

  const outputPath = path.join(
    outputWorkspace.location,
    `${getDeckFilename(parser.name)}`
  );
  const deckInfoPath = await parser.writeDeckInfo(deckSubWorkspace);

  const mcqCount = parser.payload.reduce((sum, d) => sum + d.mcqCount, 0);
  const mcqSkippedCount = parser.payload.reduce(
    (sum, d) => sum + d.mcqSkippedCount,
    0
  );

  return {
    deckInfoPath,
    outputPath,
    name: getDeckFilename(parser.name),
    inputFileName: input.name,
    deck: parser.payload,
    cardCount: parser.totalCardCount(),
    mcqCount,
    mcqSkippedCount,
    warning: aiWarning ?? parserWarning(parser),
    droppedImageCount: parser.droppedImageCount,
    expiredNotionImageCount: parser.expiredNotionImageCount,
    emptyBackCount: parser.emptyBackCount,
    parsePath: parser.parsePathSignature(),
    engine: 'parser',
    score: scoreCandidateDeck(
      parser.payload.flatMap((deck) => deck.cards),
      allFiles.reduce((sum, f) => sum + (f.size ?? f.contents?.length ?? 0), 0)
    ),
    inducedRule: shippedInducedRule(
      parser.inducedRule,
      parser.totalCardCount()
    ),
    guidEntries: parser.uploadIdentityEntries,
    uploadIdentityStats: uploadIdentityStatsFor(input, parser),
    needsIndividualBuild: false,
  };
}

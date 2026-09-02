import getDeckFilename from '../../../lib/anki/getDeckFilename';
import type { IssuedCardGuid } from '../../../lib/anki/guidLedgerTypes';
import { DeckParser, DeckParserInput } from '../../../lib/parser/DeckParser';
import Deck from '../../../lib/parser/Deck';
import {
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
import { buildPdfPasswordSentinel } from '../../../lib/pdf/pdfPasswordSentinel';
import { convertXLSXToHTML } from './convertXLSXToHTML';
import { convertDocxToHTML } from './convertDocxToHTML';
import { createWorkspaceDocxImageMediaSink } from './docxImageMediaSink';
import {
  generateDeckInfo,
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

async function convertFile(
  file: DeckParserInput['files'][number],
  input: DeckParserInput
): Promise<ConvertedFile | null> {
  if (!file.contents) return null;

  console.info('[PrepareDeck] convertFile start', {
    name: file.name,
    workspaceLocation: input.workspace.location,
    mimetype: file.name.split('.').pop() ?? 'unknown',
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
    input.noLimits
  ) {
    const result = {
      name: `${file.name}.html`,
      contents: await convertImageToHTML(
        file.contents?.toString('base64'),
        input.userId ?? null
      ),
    };
    console.log('[PrepareDeck] convertFile image', {
      file: file.name,
      durationMs: Date.now() - t0,
    });
    return result;
  }

  if (!isPDFFile(file.name) && !isPPTFile(file.name)) return null;

  if (
    isPDFFile(file.name) &&
    input.noLimits &&
    input.settings.vertexAIPDFQuestions &&
    input.settings.processPDFs !== false
  ) {
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

  if (crossFileDedup) {
    const deckInfoArrays: DeckInfo[][] = [];
    for (const file of htmlFiles) {
      const instructions = composeCrossFileInstructions(
        crossFileDedup.fronts,
        userInstructions,
        cardSize
      );
      const decks = await generateForFile(file, instructions);
      deckInfoArrays.push(absorbFileIntoCrossFileDedup(crossFileDedup, decks));
    }
    return { deckInfoArrays, crossFileDedup, ownsDedup };
  }

  const deckInfoArrays = await mapWithConcurrency(
    htmlFiles,
    HTML_GENERATION_CONCURRENCY,
    (file) => generateForFile(file, userInstructions)
  );
  return { deckInfoArrays, crossFileDedup, ownsDedup };
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

  const { deckInfoArrays, crossFileDedup, ownsDedup } =
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

  const deckInfo = deckInfoArrays.flatMap((decks, i) => {
    const prefix = deckPrefixFromFilePath(htmlFiles[i].name);
    return decks
      .filter((d) => d.cards.length > 0)
      .map((d) => ({
        ...d,
        name: prefix ? `${prefix}::${d.name}` : d.name,
      }));
  });
  console.log('[PrepareDeck] Claude branch: generateDeckInfo done', {
    durationMs: Date.now() - tClaude,
    htmlFilesProcessed: htmlFiles.length,
    totalDecks: deckInfo.length,
    totalCards: deckInfo.reduce((sum, d) => sum + d.cards.length, 0),
  });

  // A file whose cards were all covered by earlier files of the same upload
  // has nothing left to export. Running the Python exporter on an empty deck
  // throws PythonZeroCardsError, which — with no per-file catch in the worker
  // loop — would fail the whole upload and discard the earlier files' decks.
  // Return no deck instead; the earlier files carry the upload.
  if (crossFileDedup && deckInfo.length === 0) {
    console.info(
      '[PrepareDeck] Claude branch: file fully covered by earlier files',
      {
        suppressed: crossFileDedup.suppressed,
        filesProcessed: crossFileDedup.filesProcessed,
      }
    );
    return undefined;
  }

  const deckName =
    deckInfo.length === 1
      ? deckInfo[0].name
      : (input.name ?? deckInfo[0]?.name ?? 'Untitled Deck');
  const exporter = new CustomExporter(deckName, input.workspace.location);
  exporter.configure(deckInfo as unknown as Deck[]);
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

export async function PrepareDeck(
  input: DeckParserInput
): Promise<PrepareDeckResult | undefined> {
  const tTotal = Date.now();

  const files = dedupeFilesByName(input.files);

  console.info('[PrepareDeck] received', {
    count: files.length,
    names: files.map((f) => f.name),
    sources: files.map((f) => f.name.slice(0, 60)),
  });

  console.log('[PrepareDeck] start', {
    name: input.name,
    fileCount: files.length,
    fileNames: files.map((f) => f.name),
    claudeEnabled: input.settings.claudeAIFlashcards,
    noLimits: input.noLimits,
  });

  const tConvert = Date.now();
  const results = await mapWithConcurrency(
    files,
    FILE_CONVERSION_CONCURRENCY,
    (file) => convertFile(file, input)
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

  if (input.settings.claudeAIFlashcards && input.noLimits) {
    return buildClaudeDeck(
      input,
      allFiles,
      convertedFiles,
      pdfImageFallbackNames,
      tTotal
    );
  }

  const parser = new DeckParser({ ...input, files: allFiles });

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
        warning: parser.usedHeuristic ? 'markdown-heuristic' : undefined,
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
    warning: parser.usedHeuristic ? 'markdown-heuristic' : undefined,
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
  };
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
  needsIndividualBuild: boolean;
}

export async function prepareDeckInfoOnly(
  input: DeckParserInput,
  deckSubWorkspace: Workspace,
  outputWorkspace: Workspace
): Promise<DeckInfoOnlyResult> {
  const files = dedupeFilesByName(input.files);
  const results = await mapWithConcurrency(
    files,
    FILE_CONVERSION_CONCURRENCY,
    (file) => convertFile(file, input)
  );
  const convertedFiles = results.flatMap((r) => (r ? [r] : []));
  const allFiles = assembleParserFiles(files, convertedFiles);

  const parser = new DeckParser({ ...input, files: allFiles });

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
        warning: parser.usedHeuristic ? 'markdown-heuristic' : undefined,
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
    warning: parser.usedHeuristic ? 'markdown-heuristic' : undefined,
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
    needsIndividualBuild: false,
  };
}

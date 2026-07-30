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
} from './convertPdfTextToHtml';
import { buildPdfPasswordSentinel } from '../../../lib/pdf/pdfPasswordSentinel';
import { convertXLSXToHTML } from './convertXLSXToHTML';
import { convertDocxToHTML } from './convertDocxToHTML';
import { createWorkspaceDocxImageMediaSink } from './docxImageMediaSink';
import { generateDeckInfo, DeckInfo } from '../../../lib/claude/ClaudeService';
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
    const result = {
      name: `${file.name}.html`,
      contents: Buffer.from(
        await convertDocxToHTML(file.contents as Buffer, mediaSink, {
          bulletFanOut: input.settings.overlappingCloze === 'off',
        })
      ),
    };
    console.log('[PrepareDeck] convertFile docx', {
      file: file.name,
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
      contents: await convertImageToHTML(file.contents?.toString('base64')),
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
          input.settings.userInstructions
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
  imageFallback?: boolean;
}

async function convertPdfPagesToImagesFile(
  file: DeckParserInput['files'][number],
  input: DeckParserInput
): Promise<ConvertedFile> {
  return {
    name: `${file.name}.html`,
    contents: Buffer.from(
      await convertPDFToImages({
        name: file.name,
        workspace: input.workspace,
        noLimits: input.noLimits,
        contents: file.contents as Buffer,
        settings: input.settings,
      })
    ),
    imageFallback: true,
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
    input.pdfCredential
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
    input.pdfCredential
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

function mediaFilesForHtmlFile(
  htmlFileName: string,
  allMediaFiles: string[]
): string[] {
  const normalized = htmlFileName.replaceAll('\\', '/');
  const lastSlash = normalized.lastIndexOf('/');
  const dir = lastSlash >= 0 ? normalized.substring(0, lastSlash) : '';
  const base = normalized
    .substring(lastSlash + 1)
    .replace(/\.html$/i, '')
    .replace(/ [a-f0-9]{32}$/i, '')
    .trim();
  const prefix = dir ? `${dir}/${base}/` : `${base}/`;
  return allMediaFiles.filter((m) =>
    m.replaceAll('\\', '/').startsWith(prefix)
  );
}

export async function PrepareDeck(
  input: DeckParserInput
): Promise<PrepareDeckResult> {
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

  const allFiles = [...files, ...convertedFiles];

  if (input.settings.claudeAIFlashcards && input.noLimits) {
    console.log('[PrepareDeck] Claude branch: collecting HTML content');
    const htmlFiles = allFiles.filter(
      (f) => (isHTMLFile(f.name) || isMarkdownFile(f.name)) && f.contents
    );

    const mediaFiles = allFiles
      .filter((f) => !isHTMLFile(f.name) && !isMarkdownFile(f.name))
      .map((f) => f.name);

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
      comprehensive: input.settings.aiComprehensive,
    };
    const deckInfoArrays: DeckInfo[][] = await mapWithConcurrency(
      htmlFiles,
      HTML_GENERATION_CONCURRENCY,
      (f) =>
        generateDeckInfo(
          f.contents!.toString(),
          mediaFilesForHtmlFile(f.name, mediaFiles),
          userInstructions,
          input.onProgress,
          cardStyle,
          input.settings.cardSize,
          fieldMapping,
          pdfImageFallbackNames.has(f.name)
            ? {
                ...baseGenerateDeckInfoOptions,
                pdfImageFallback: { mediaBaseDir: input.workspace.location },
              }
            : baseGenerateDeckInfoOptions
        )
    );
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

    const deckName =
      deckInfo.length === 1
        ? deckInfo[0].name
        : (input.name ?? deckInfo[0]?.name ?? 'Untitled Deck');
    const exporter = new CustomExporter(deckName, input.workspace.location);
    exporter.configure(deckInfo as unknown as Deck[]);
    const tExport = Date.now();
    const apkg = await exporter.save();
    const claudeCardCount = deckInfo.reduce(
      (sum, d) => sum + d.cards.length,
      0
    );
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
        htmlFiles.reduce((sum, f) => sum + (f.contents?.length ?? 0), 0)
      ),
      mcqCount: 0,
      mcqSkippedCount: 0,
      droppedImageCount: 0,
      emptyBackCount: 0,
    };
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
        emptyBackCount: parser.emptyBackCount,
        // This is the branch a document takes when nothing recognised it, so it
        // is exactly the population a rescue has to clear. Without a score here
        // the corpus is made only of successes, and a floor calibrated on
        // successes cannot judge a failure.
        engine: 'parser',
        score: scoreCandidateDeck(
          parser.payload.flatMap((deck) => deck.cards),
          allFiles.reduce((sum, f) => sum + (f.contents?.length ?? 0), 0)
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
    emptyBackCount: parser.emptyBackCount,
    parsePath: parser.parsePathSignature(),
    engine: 'parser',
    score: scoreCandidateDeck(
      parser.payload.flatMap((deck) => deck.cards),
      allFiles.reduce((sum, f) => sum + (f.contents?.length ?? 0), 0)
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
  emptyBackCount: number;
  parsePath?: string;
  engine?: ConversionEngine;
  score?: DeckScore;
  inducedRule?: InducedRescue;
  guidEntries?: IssuedCardGuid[];
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
  const allFiles = [...files, ...convertedFiles];

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
    emptyBackCount: parser.emptyBackCount,
    parsePath: parser.parsePathSignature(),
    engine: 'parser',
    score: scoreCandidateDeck(
      parser.payload.flatMap((deck) => deck.cards),
      allFiles.reduce((sum, f) => sum + (f.contents?.length ?? 0), 0)
    ),
    inducedRule: shippedInducedRule(
      parser.inducedRule,
      parser.totalCardCount()
    ),
    guidEntries: parser.issuedGuidEntries,
    needsIndividualBuild: false,
  };
}

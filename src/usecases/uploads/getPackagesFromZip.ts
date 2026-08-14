import fs from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import { collectIssuedGuids } from '../../lib/anki/collectIssuedGuids';
import type { KnownGuids } from '../../lib/anki/guidLedgerTypes';
import CardOption from '../../lib/parser/Settings/CardOption';
import { ZipHandler } from '../../lib/zip/zip';
import {
  PrepareDeck,
  prepareDeckInfoOnly,
  DeckInfoOnlyResult,
} from '../../infrastracture/adapters/fileConversion/PrepareDeck';
import Package from '../../lib/parser/Package';
import type { CrossFileDedupState } from '../../lib/claude/ClaudeService';
import { PackageResult } from './GeneratePackagesUseCase';
import Workspace from '../../lib/parser/WorkSpace';
import { getMaxUploadCount } from '../../lib/misc/getMaxUploadCount';

import { isZipContentFileSupported } from './isZipContentFileSupported';
import { convertAnkiAppDecksFromZip } from './convertAnkiAppDecksFromZip';
import { getRelevantFiles } from './getRelevantFiles';
import { enableMarkdownForMarkdownUploads } from './enableMarkdownForMarkdownUploads';
import CardGenerator from '../../lib/anki/CardGenerator';
import { resolvePerWorkerPythonCap } from '../../lib/pythonWorkerBudget';
import {
  isPdfPasswordSentinel,
  parsePdfPasswordSentinel,
} from '../../lib/pdf/pdfPasswordSentinel';
import { buildLockedPdfWarning } from '../../lib/pdf/lockedPdfWarning';
import { buildConversionFailureWarning } from './conversionFailureWarning';

const LOCKED_PDF = Symbol('locked-pdf');

interface LockedPdfEntry {
  marker: typeof LOCKED_PDF;
  filename: string;
}

function isLockedPdfEntry(value: unknown): value is LockedPdfEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as LockedPdfEntry).marker === LOCKED_PDF
  );
}

async function convertSkippingLockedPdf<T>(
  fileName: string,
  convert: () => Promise<T>
): Promise<T | LockedPdfEntry> {
  try {
    return await convert();
  } catch (error) {
    if (error instanceof Error && isPdfPasswordSentinel(error.message)) {
      return {
        marker: LOCKED_PDF,
        filename: parsePdfPasswordSentinel(error.message) ?? fileName,
      };
    }
    throw error;
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

interface BatchOutcome {
  packages: Package[];
  warnings: string[];
  lockedPdfs: string[];
  failedFiles: string[];
}

async function buildDeckBatch(
  fileNames: string[],
  zipHandler: ZipHandler,
  settings: CardOption,
  paying: boolean,
  workspace: Workspace,
  knownGuids?: KnownGuids
): Promise<BatchOutcome> {
  const packages: Package[] = [];
  const warnings: string[] = [];

  const settled = await Promise.allSettled(
    fileNames.map((fileName) => {
      const relevantFiles = getRelevantFiles(fileName, zipHandler.files);
      const deckSubWorkspace = Workspace.subdir(workspace.location);
      return convertSkippingLockedPdf(fileName, () =>
        prepareDeckInfoOnly(
          {
            name: fileName,
            files: relevantFiles,
            settings,
            noLimits: paying,
            workspace: deckSubWorkspace,
            knownGuids,
          },
          deckSubWorkspace,
          workspace
        )
      );
    })
  );

  const lockedPdfs: string[] = [];
  const failedFiles: string[] = [];
  const preparedResults: DeckInfoOnlyResult[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      failedFiles.push(fileNames[index]);
    } else if (isLockedPdfEntry(result.value)) {
      lockedPdfs.push(result.value.filename);
    } else {
      preparedResults.push(result.value);
    }
  });

  const batchResults = preparedResults.filter((r) => !r.needsIndividualBuild);
  const batchEntries = batchResults.map((r) => ({
    input: r.deckInfoPath,
    output: r.outputPath,
  }));

  const stragglers: { inputFileName: string }[] = preparedResults.filter(
    (r) => r.needsIndividualBuild
  );

  if (batchEntries.length > 0) {
    const gen = new CardGenerator(workspace.location);
    // The Python batch reports each built deck by printing its output path;
    // pairing by that path (never by position) keeps one skipped entry from
    // shifting every deck after it. A deck the batch failed to build — or a
    // batch process that died outright — retries on the individual path below
    // instead of silently shipping nothing (#4028).
    let producedPaths = new Set<string>();
    try {
      producedPaths = new Set(await gen.runBatch(batchEntries));
    } catch (error) {
      console.warn(
        '[batch-build] batch deck build failed, rebuilding decks individually',
        error
      );
    }

    batchResults.forEach((result) => {
      if (!producedPaths.has(result.outputPath)) {
        if (result.cardCount > 0) {
          stragglers.push(result);
        }
        return;
      }
      const pkg = new Package(
        result.name,
        result.cardCount,
        result.mcqCount,
        result.mcqSkippedCount,
        result.droppedImageCount,
        result.emptyBackCount ?? 0,
        result.parsePath
      );
      pkg.engine = result.engine;
      pkg.score = result.score;
      pkg.inducedRule = result.inducedRule;
      pkg.guidEntries = collectIssuedGuids(
        path.dirname(result.deckInfoPath),
        result.deck,
        knownGuids
      );
      pkg.expiredNotionImageCount = result.expiredNotionImageCount ?? 0;
      packages.push(pkg);
      if (result.warning) warnings.push(result.warning);
    });
  }

  const stragglerOutcomes = await buildStragglerDecks(
    stragglers,
    zipHandler,
    settings,
    paying,
    workspace,
    knownGuids
  );
  packages.push(...stragglerOutcomes.packages);
  warnings.push(...stragglerOutcomes.warnings);
  lockedPdfs.push(...stragglerOutcomes.lockedPdfs);
  failedFiles.push(...stragglerOutcomes.failedFiles);

  return { packages, warnings, lockedPdfs, failedFiles };
}

async function buildStragglerDecks(
  stragglers: { inputFileName: string }[],
  zipHandler: ZipHandler,
  settings: CardOption,
  paying: boolean,
  workspace: Workspace,
  knownGuids?: KnownGuids
): Promise<BatchOutcome> {
  const packages: Package[] = [];
  const warnings: string[] = [];
  const lockedPdfs: string[] = [];
  const failedFiles: string[] = [];

  for (const straggler of stragglers) {
    const relevantFiles = getRelevantFiles(
      straggler.inputFileName,
      zipHandler.files
    );
    let outcome;
    try {
      outcome = await convertSkippingLockedPdf(straggler.inputFileName, () =>
        PrepareDeck({
          name: straggler.inputFileName,
          files: relevantFiles,
          settings,
          noLimits: paying,
          workspace,
          knownGuids,
        })
      );
    } catch {
      failedFiles.push(straggler.inputFileName);
      continue;
    }
    if (isLockedPdfEntry(outcome)) {
      lockedPdfs.push(outcome.filename);
    } else if (outcome) {
      const pkg = new Package(
        outcome.name,
        outcome.cardCount ?? 0,
        outcome.mcqCount ?? 0,
        outcome.mcqSkippedCount ?? 0,
        outcome.droppedImageCount ?? 0,
        outcome.emptyBackCount ?? 0,
        outcome.parsePath
      );
      pkg.engine = outcome.engine;
      pkg.score = outcome.score;
      pkg.inducedRule = outcome.inducedRule;
      pkg.guidEntries = outcome.guidEntries;
      pkg.expiredNotionImageCount = outcome.expiredNotionImageCount ?? 0;
      packages.push(pkg);
      if (outcome.warning) warnings.push(outcome.warning);
    }
  }

  return { packages, warnings, lockedPdfs, failedFiles };
}

async function buildClaudeFlashcardDeck(
  rootName: string,
  zipHandler: ZipHandler,
  settings: CardOption,
  paying: boolean,
  workspace: Workspace,
  onProgress: ((step: string) => void) | undefined,
  ctx: { userId: number | null; crossFileDedup?: CrossFileDedupState }
): Promise<PackageResult> {
  const deck = await PrepareDeck({
    name: rootName,
    files: zipHandler.files,
    settings,
    noLimits: paying,
    workspace,
    onProgress,
    userId: ctx.userId,
    crossFileDedup: ctx.crossFileDedup,
  });

  const packages: Package[] = [];
  const warnings: string[] = [];
  if (deck) {
    const pkg = new Package(
      deck.name,
      deck.cardCount ?? 0,
      deck.mcqCount ?? 0,
      deck.mcqSkippedCount ?? 0,
      deck.droppedImageCount ?? 0,
      deck.emptyBackCount ?? 0,
      deck.parsePath
    );
    pkg.expiredNotionImageCount = deck.expiredNotionImageCount ?? 0;
    packages.push(pkg);
    if (deck.warning) warnings.push(deck.warning);
  }
  return { packages, warnings };
}

// The downloader lists decks by reading the top-level workspace, so a deck
// built in a per-conversion subdirectory has to be lifted back up. A name that
// is already taken gets a suffix rather than replacing the deck that got there
// first — silently overwriting is the failure this whole change removes.
async function liftDecksToParent(from: Workspace, to: Workspace) {
  if (!fs.existsSync(from.location)) return;
  const entries = await fs.promises.readdir(from.location);
  for (const entry of entries) {
    if (!entry.endsWith('.apkg')) continue;
    const extension = path.extname(entry);
    const base = entry.slice(0, -extension.length);
    let candidate = entry;
    let suffix = 2;
    while (fs.existsSync(path.join(to.location, candidate))) {
      candidate = `${base} (${suffix})${extension}`;
      suffix += 1;
    }
    await fs.promises.rename(
      path.join(from.location, entry),
      path.join(to.location, candidate)
    );
  }
}

async function buildAllInOneSlot(
  supportedFileNames: string[],
  zipHandler: ZipHandler,
  settings: CardOption,
  paying: boolean,
  workspace: Workspace,
  cap: number,
  knownGuids?: KnownGuids
): Promise<PackageResult> {
  const limit = pLimit(cap);
  const settled = await Promise.allSettled(
    supportedFileNames.map((fileName) =>
      limit(() => {
        const relevantFiles = getRelevantFiles(fileName, zipHandler.files);
        // Every conversion needs its own workspace. CustomExporter writes
        // deck_info.json at a fixed path inside it, and the Python child reads
        // that file hundreds of milliseconds later — so with a shared workspace
        // a concurrent conversion overwrites the payload first and both
        // processes build the same deck.
        const deckWorkspace = Workspace.subdir(workspace.location);
        return convertSkippingLockedPdf(fileName, async () => {
          const result = await PrepareDeck({
            name: fileName,
            files: relevantFiles,
            settings,
            noLimits: paying,
            workspace: deckWorkspace,
            knownGuids,
          });
          await liftDecksToParent(deckWorkspace, workspace);
          return result;
        });
      })
    )
  );

  const packages: Package[] = [];
  const warnings: string[] = [];
  const lockedPdfs: string[] = [];
  const failedFiles: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      failedFiles.push(supportedFileNames[index]);
      return;
    }
    const outcome = result.value;
    if (isLockedPdfEntry(outcome)) {
      lockedPdfs.push(outcome.filename);
    } else if (outcome) {
      const pkg = new Package(
        outcome.name,
        outcome.cardCount ?? 0,
        outcome.mcqCount ?? 0,
        outcome.mcqSkippedCount ?? 0,
        outcome.droppedImageCount ?? 0,
        outcome.emptyBackCount ?? 0,
        outcome.parsePath
      );
      pkg.engine = outcome.engine;
      pkg.score = outcome.score;
      pkg.inducedRule = outcome.inducedRule;
      pkg.guidEntries = outcome.guidEntries;
      pkg.expiredNotionImageCount = outcome.expiredNotionImageCount ?? 0;
      packages.push(pkg);
      if (outcome.warning) warnings.push(outcome.warning);
    }
  });
  appendLockedPdfWarning(warnings, lockedPdfs);
  appendConversionFailureWarning(warnings, failedFiles);
  return { packages, warnings };
}

function appendLockedPdfWarning(warnings: string[], lockedPdfs: string[]) {
  const lockedWarning = buildLockedPdfWarning(lockedPdfs);
  if (lockedWarning) warnings.push(lockedWarning);
}

function appendConversionFailureWarning(
  warnings: string[],
  failedFiles: string[]
) {
  const failureWarning = buildConversionFailureWarning(failedFiles);
  if (failureWarning) warnings.push(failureWarning);
}

export interface GetPackagesFromZipOptions {
  knownGuids?: KnownGuids;
  crossFileDedup?: CrossFileDedupState;
}

export const getPackagesFromZip = async (
  fileContents: Buffer | Uint8Array | string | undefined,
  paying: boolean,
  settings: CardOption,
  workspace: Workspace,
  onProgress?: (step: string) => void,
  userId: number | null = null,
  options: GetPackagesFromZipOptions = {}
): Promise<PackageResult> => {
  const { knownGuids, crossFileDedup } = options;
  if (!fileContents) {
    return { packages: [] };
  }

  const zipHandler = new ZipHandler(getMaxUploadCount(paying));
  await zipHandler.build(
    fileContents as Uint8Array,
    paying,
    settings,
    workspace.location
  );

  const ankiAppResult = await convertAnkiAppDecksFromZip(
    zipHandler.files,
    workspace
  );
  if (ankiAppResult) {
    return ankiAppResult;
  }

  const fileNames = zipHandler.getFileNames();
  const supportedFileNames = fileNames.filter(isZipContentFileSupported);
  const effectiveSettings = enableMarkdownForMarkdownUploads(
    fileNames,
    settings
  );

  if (effectiveSettings.claudeAIFlashcards && paying && fileNames.length > 0) {
    return buildClaudeFlashcardDeck(
      fileNames[0],
      zipHandler,
      effectiveSettings,
      paying,
      workspace,
      onProgress,
      { userId, crossFileDedup }
    );
  }

  const cap = resolvePerWorkerPythonCap();
  const batchSize = Math.ceil(supportedFileNames.length / cap);

  if (supportedFileNames.length <= 1 || batchSize <= 1) {
    return buildAllInOneSlot(
      supportedFileNames,
      zipHandler,
      effectiveSettings,
      paying,
      workspace,
      cap,
      knownGuids
    );
  }

  const chunks = chunkArray(supportedFileNames, batchSize);
  const limit = pLimit(cap);

  const settledChunks = await Promise.allSettled(
    chunks.map((chunk) =>
      limit(() =>
        buildDeckBatch(
          chunk,
          zipHandler,
          effectiveSettings,
          paying,
          workspace,
          knownGuids
        )
      )
    )
  );

  const packages: Package[] = [];
  const warnings: string[] = [];
  const lockedPdfs: string[] = [];
  const failedFiles: string[] = [];
  settledChunks.forEach((result, index) => {
    if (result.status === 'rejected') {
      failedFiles.push(...chunks[index]);
      return;
    }
    packages.push(...result.value.packages);
    warnings.push(...result.value.warnings);
    lockedPdfs.push(...result.value.lockedPdfs);
    failedFiles.push(...result.value.failedFiles);
  });
  appendLockedPdfWarning(warnings, lockedPdfs);
  appendConversionFailureWarning(warnings, failedFiles);

  return { packages, warnings };
};

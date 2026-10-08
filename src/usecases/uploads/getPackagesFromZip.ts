import fs from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import { collectIssuedGuids } from '../../lib/anki/collectIssuedGuids';
import type { KnownGuids } from '../../lib/anki/guidLedgerTypes';
import type { UploadIdentityContext } from '../../lib/parser/DeckParser';
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
import { ANKI_PACKAGE_ZIP_MESSAGE, isAnkiPackageZip } from './isAnkiPackageZip';
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
import {
  EmptyDeckError,
  EmptyDeckReason,
  mostSpecificEmptyReason,
} from '../jobs/EmptyDeckError';

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
  emptyReasons: EmptyDeckReason[];
}

// A file that produced no cards still knows why: it either threw an
// EmptyDeckError (prose text, a page with no toggles) or returned a zero-card
// result carrying the parser's classification. Capturing both keeps the reason
// from being flattened to unknown when the whole upload comes out empty.
function reasonFromRejection(error: unknown): EmptyDeckReason | undefined {
  return error instanceof EmptyDeckError ? error.reason : undefined;
}

function reasonFromZeroCardResult(result: {
  cardCount?: number;
  emptyReason?: EmptyDeckReason;
}): EmptyDeckReason | undefined {
  return (result.cardCount ?? 0) === 0 ? result.emptyReason : undefined;
}

interface BatchBuildContext {
  settings: CardOption;
  paying: boolean;
  workspace: Workspace;
  userId: number | null;
  knownGuids?: KnownGuids;
  uploadIdentity?: UploadIdentityContext;
}

async function buildDeckBatch(
  fileNames: string[],
  zipHandler: ZipHandler,
  ctx: BatchBuildContext
): Promise<BatchOutcome> {
  const { settings, paying, workspace, userId, knownGuids, uploadIdentity } =
    ctx;
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
            userId,
            knownGuids,
            uploadIdentity,
          },
          deckSubWorkspace,
          workspace
        )
      );
    })
  );

  const lockedPdfs: string[] = [];
  const failedFiles: string[] = [];
  const emptyReasons: EmptyDeckReason[] = [];
  const preparedResults: DeckInfoOnlyResult[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      failedFiles.push(fileNames[index]);
      const reason = reasonFromRejection(result.reason);
      if (reason != null) emptyReasons.push(reason);
    } else if (isLockedPdfEntry(result.value)) {
      lockedPdfs.push(result.value.filename);
    } else {
      preparedResults.push(result.value);
      const reason = reasonFromZeroCardResult(result.value);
      if (reason != null) emptyReasons.push(reason);
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
      pkg.guidEntries = [
        ...collectIssuedGuids(
          path.dirname(result.deckInfoPath),
          result.deck,
          knownGuids
        ),
        ...(result.guidEntries ?? []),
      ];
      pkg.uploadIdentityStats = result.uploadIdentityStats;
      pkg.expiredNotionImageCount = result.expiredNotionImageCount ?? 0;
      pkg.missingLocalImageCount = result.missingLocalImageCount ?? 0;
      pkg.coloredTextPageCount = result.coloredTextPageCount ?? 0;
      packages.push(pkg);
      if (result.warning) warnings.push(result.warning);
    });
  }

  const stragglerOutcomes = await buildStragglerDecks(
    stragglers,
    zipHandler,
    ctx
  );
  packages.push(...stragglerOutcomes.packages);
  warnings.push(...stragglerOutcomes.warnings);
  lockedPdfs.push(...stragglerOutcomes.lockedPdfs);
  failedFiles.push(...stragglerOutcomes.failedFiles);
  emptyReasons.push(...stragglerOutcomes.emptyReasons);

  return { packages, warnings, lockedPdfs, failedFiles, emptyReasons };
}

async function buildStragglerDecks(
  stragglers: { inputFileName: string }[],
  zipHandler: ZipHandler,
  ctx: BatchBuildContext
): Promise<BatchOutcome> {
  const { settings, paying, workspace, userId, knownGuids, uploadIdentity } =
    ctx;
  const packages: Package[] = [];
  const warnings: string[] = [];
  const lockedPdfs: string[] = [];
  const failedFiles: string[] = [];
  const emptyReasons: EmptyDeckReason[] = [];

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
          userId,
          knownGuids,
          uploadIdentity,
        })
      );
    } catch (error) {
      failedFiles.push(straggler.inputFileName);
      const reason = reasonFromRejection(error);
      if (reason != null) emptyReasons.push(reason);
      continue;
    }
    if (isLockedPdfEntry(outcome)) {
      lockedPdfs.push(outcome.filename);
    } else if (outcome) {
      const reason = reasonFromZeroCardResult(outcome);
      if (reason != null) emptyReasons.push(reason);
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
      pkg.uploadIdentityStats = outcome.uploadIdentityStats;
      pkg.expiredNotionImageCount = outcome.expiredNotionImageCount ?? 0;
      pkg.missingLocalImageCount = outcome.missingLocalImageCount ?? 0;
      pkg.coloredTextPageCount = outcome.coloredTextPageCount ?? 0;
      packages.push(pkg);
      if (outcome.warning) warnings.push(outcome.warning);
    }
  }

  return { packages, warnings, lockedPdfs, failedFiles, emptyReasons };
}

async function buildClaudeFlashcardDeck(
  rootName: string,
  zipHandler: ZipHandler,
  settings: CardOption,
  paying: boolean,
  workspace: Workspace,
  onProgress: ((step: string) => void) | undefined,
  ctx: {
    userId: number | null;
    requestId?: string;
    crossFileDedup?: CrossFileDedupState;
  }
): Promise<PackageResult> {
  const deck = await PrepareDeck({
    name: rootName,
    files: zipHandler.files,
    settings,
    noLimits: paying,
    workspace,
    onProgress,
    userId: ctx.userId,
    requestId: ctx.requestId,
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
    pkg.missingLocalImageCount = deck.missingLocalImageCount ?? 0;
    pkg.coloredTextPageCount = deck.coloredTextPageCount ?? 0;
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
  cap: number,
  ctx: BatchBuildContext,
  cardLimit?: number
): Promise<PackageResult> {
  const { settings, paying, workspace, userId, knownGuids, uploadIdentity } =
    ctx;
  // Partial delivery only has a coherent "first N cards" meaning for a zip that
  // resolves to a single deck; a per-file limit on a multi-deck zip would cap
  // every deck at N and over-deliver, so it only applies to a lone content file.
  const perFileCardLimit =
    supportedFileNames.length === 1 ? cardLimit : undefined;
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
            userId,
            knownGuids,
            uploadIdentity,
            cardLimit: perFileCardLimit,
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
  const emptyReasons: EmptyDeckReason[] = [];
  let cardsHeldBack: number | undefined;
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      failedFiles.push(supportedFileNames[index]);
      const reason = reasonFromRejection(result.reason);
      if (reason != null) emptyReasons.push(reason);
      return;
    }
    const outcome = result.value;
    if (isLockedPdfEntry(outcome)) {
      lockedPdfs.push(outcome.filename);
    } else if (outcome) {
      const reason = reasonFromZeroCardResult(outcome);
      if (reason != null) emptyReasons.push(reason);
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
      pkg.uploadIdentityStats = outcome.uploadIdentityStats;
      pkg.expiredNotionImageCount = outcome.expiredNotionImageCount ?? 0;
      pkg.missingLocalImageCount = outcome.missingLocalImageCount ?? 0;
      pkg.coloredTextPageCount = outcome.coloredTextPageCount ?? 0;
      packages.push(pkg);
      if (outcome.warning) warnings.push(outcome.warning);
      if (perFileCardLimit != null) {
        cardsHeldBack = outcome.cardsHeldBack ?? 0;
      }
    }
  });
  appendLockedPdfWarning(warnings, lockedPdfs);
  appendConversionFailureWarning(warnings, failedFiles);
  return {
    packages,
    warnings,
    cardsHeldBack,
    emptyReason: emptyReasonForEmptyResult(packages, emptyReasons),
  };
}

// Only attach a reason when the slot produced no cards at all; a zip where one
// file converted and another came up empty is a success, and tagging it with
// the empty file's reason would mislabel it.
function emptyReasonForEmptyResult(
  packages: Package[],
  emptyReasons: EmptyDeckReason[]
): EmptyDeckReason | undefined {
  const totalCards = packages.reduce((sum, p) => sum + (p.cardCount ?? 0), 0);
  if (totalCards > 0 || emptyReasons.length === 0) {
    return undefined;
  }
  return mostSpecificEmptyReason(emptyReasons);
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
  uploadIdentity?: UploadIdentityContext;
  requestId?: string;
  crossFileDedup?: CrossFileDedupState;
  cardLimit?: number;
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
  const { knownGuids, uploadIdentity, requestId, crossFileDedup, cardLimit } =
    options;
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

  if (isAnkiPackageZip(zipHandler.getFileNames())) {
    throw new Error(ANKI_PACKAGE_ZIP_MESSAGE);
  }

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
      { userId, requestId, crossFileDedup }
    );
  }

  const cap = resolvePerWorkerPythonCap();
  const batchSize = Math.ceil(supportedFileNames.length / cap);
  const batchCtx: BatchBuildContext = {
    settings: effectiveSettings,
    paying,
    workspace,
    userId,
    knownGuids,
    uploadIdentity,
  };

  if (supportedFileNames.length <= 1 || batchSize <= 1) {
    return buildAllInOneSlot(
      supportedFileNames,
      zipHandler,
      cap,
      batchCtx,
      cardLimit
    );
  }

  const chunks = chunkArray(supportedFileNames, batchSize);
  const limit = pLimit(cap);

  const settledChunks = await Promise.allSettled(
    chunks.map((chunk) =>
      limit(() => buildDeckBatch(chunk, zipHandler, batchCtx))
    )
  );

  const packages: Package[] = [];
  const warnings: string[] = [];
  const lockedPdfs: string[] = [];
  const failedFiles: string[] = [];
  const emptyReasons: EmptyDeckReason[] = [];
  settledChunks.forEach((result, index) => {
    if (result.status === 'rejected') {
      failedFiles.push(...chunks[index]);
      const reason = reasonFromRejection(result.reason);
      if (reason != null) emptyReasons.push(reason);
      return;
    }
    packages.push(...result.value.packages);
    warnings.push(...result.value.warnings);
    lockedPdfs.push(...result.value.lockedPdfs);
    failedFiles.push(...result.value.failedFiles);
    emptyReasons.push(...result.value.emptyReasons);
  });
  appendLockedPdfWarning(warnings, lockedPdfs);
  appendConversionFailureWarning(warnings, failedFiles);

  return {
    packages,
    warnings,
    emptyReason: emptyReasonForEmptyResult(packages, emptyReasons),
  };
};

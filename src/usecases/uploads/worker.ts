import { getEventsSink } from '../../services/events/eventsSinkInstance';
import {
  mergeRescueCandidates,
  type RescueCandidate,
} from '../../types/RescueCandidate';
import { track } from '../../services/events/track';
import { UploadedFile } from '../../lib/storage/types';
import type { KnownGuids } from '../../lib/anki/guidLedgerTypes';
import type { UploadIdentityContext } from '../../lib/parser/DeckParser';
import CardOption from '../../lib/parser/Settings/CardOption';
import { processUploadedPdf } from './processUploadedPdf';
import Package from '../../lib/parser/Package';
import fs from 'fs';
import pLimit from 'p-limit';
import { asReadableUpload } from '../../lib/rtf/readableUpload';
import { hasUnknownExtension } from '../../lib/storage/sniffUpload';
import { PrepareDeck } from '../../infrastracture/adapters/fileConversion/PrepareDeck';
import { applyPdfPageRange } from '../../infrastracture/adapters/fileConversion/applyPdfPageRange';
import {
  isImageFile,
  isCompressedFile,
  isPPTFile,
  isDocxFile,
  isOpmlFile,
  isBrainstormsJsonFile,
  isEpubFile,
  isKindleClippingsFile,
  isAnkiDeckFile,
  isAnkiAppExportXml,
  isXmlFile,
} from '../../lib/storage/checks';
import { getPackagesFromZip } from './getPackagesFromZip';
import { liftDecksToParent } from './liftDecksToParent';
import { resolvePerWorkerPythonCap } from '../../lib/pythonWorkerBudget';
import { AI_FILE_CONCURRENCY } from '../../lib/claude/aiFileConcurrency';
import { isWorkerTerminationError } from '../../lib/workerTermination';
import Workspace from '../../lib/parser/WorkSpace';
import { detectOverSplit } from '../../lib/parser/detectOverSplit';
import { isZipContentFileSupported } from './isZipContentFileSupported';
import {
  CrossFileDedupState,
  createCrossFileDedupState,
  collectNewFingerprints,
} from '../../lib/claude/ClaudeService';
import { convertMindmapFileToApkg } from './ConvertMindmapFileUseCase';
import {
  convertAnkiAppExportToApkg,
  describeSkippedMediaOnlyCards,
} from './ConvertAnkiAppExportUseCase';
import {
  buildVocabDeckFromEpub,
  buildVocabDeckFromKindleClippings,
} from './BuildVocabDeckUseCase';
import {
  EmptyDeckError,
  EmptyDeckReason,
  mostSpecificEmptyReason,
} from '../jobs/EmptyDeckError';
import {
  UploadGenerationResult,
  UploadGenerationTask,
} from './uploadGenerationTypes';

function logFileRead(
  readStartedAt: number,
  mode: 'buffer' | 'disk' | 'buffer-fallback',
  contents: Buffer
): void {
  console.info('[upload] tempfile read', {
    readMs: Date.now() - readStartedAt,
    mode,
    fileSizeBytes: contents.byteLength,
  });
}

export function getFileContents(file: UploadedFile): Buffer {
  const readStartedAt = Date.now();
  let result: Buffer;

  if (!file.path) {
    if (file.buffer == null) {
      throw new Error('Uploaded file has neither a path nor a buffer');
    }
    result = Buffer.from(file.buffer);
    logFileRead(readStartedAt, 'buffer', result);
    return result;
  }

  try {
    if (fs.existsSync(file.path)) {
      result = fs.readFileSync(file.path);
      logFileRead(readStartedAt, 'disk', result);
      return result;
    }
  } catch (error) {
    throw new Error(
      `Error reading file at path: ${file.path}: ${String(error)}`
    );
  }

  if (file.buffer == null) {
    throw new Error(
      'Uploaded file is no longer available on disk and has no buffer fallback'
    );
  }
  result = Buffer.from(file.buffer);
  logFileRead(readStartedAt, 'buffer-fallback', result);
  return result;
}

interface FileResult {
  packages: Package[];
  warnings: string[];
  cardsHeldBack?: number;
  emptyReason?: EmptyDeckReason;
  rescueCandidates?: RescueCandidate[];
}

// Files handled by these branches in processFile pre-empt the Claude/PrepareDeck
// route, so they must not count toward the cross-file gate even when their
// extension (e.g. "My Clippings.txt" matching isPlainText) otherwise would.
function routedAwayFromClaude(name: string): boolean {
  return (
    isAnkiDeckFile(name) ||
    isXmlFile(name) ||
    isOpmlFile(name) ||
    isBrainstormsJsonFile(name) ||
    isKindleClippingsFile(name) ||
    isEpubFile(name)
  );
}

// Mirror the exact set of files processFile routes into PrepareDeck's Claude
// branch (single content files and zips), so the dedup gate opens on the same
// files the sequential/backstop path will actually see. Zips count as one
// container: their true content-file count is only known after extraction, and
// the emitted source_file_count uses filesProcessed for the accurate number.
export function reachesClaudeContentPath(
  file: UploadedFile,
  paying: boolean,
  settings: CardOption
): boolean {
  const name = file.originalname;
  if (routedAwayFromClaude(name)) return false;
  const isImageQuiz =
    paying && settings.imageQuizHtmlToAnki && isImageFile(name);
  const isSingleContent =
    isZipContentFileSupported(name) || isPPTFile(name) || isImageQuiz;
  return Boolean(
    isSingleContent || isCompressedFile(name) || hasUnknownExtension(name)
  );
}

export function countAiContentFiles(
  files: UploadedFile[],
  paying: boolean,
  settings: CardOption
): number {
  return files.filter((f) => reachesClaudeContentPath(f, paying, settings))
    .length;
}

export function shouldDedupeAcrossFiles(
  paying: boolean,
  settings: CardOption,
  files: UploadedFile[]
): boolean {
  return (
    paying &&
    settings.claudeAIFlashcards &&
    countAiContentFiles(files, paying, settings) >= 2
  );
}

// Cross-deck dedup (#4243) needs the accumulator whenever a signed-in paying
// user runs the AI path over at least one content file — even a single file,
// so it dedupes against their prior decks and records its own fingerprints for
// next time. Anonymous or multi-file uploads still go through
// shouldDedupeAcrossFiles for the same-upload backstop.
export function shouldDedupeAcrossDecks(
  paying: boolean,
  settings: CardOption,
  files: UploadedFile[],
  userId: number | null
): boolean {
  return (
    userId != null &&
    paying &&
    settings.claudeAIFlashcards &&
    countAiContentFiles(files, paying, settings) >= 1
  );
}

async function processFile(
  file: UploadedFile,
  fileContents: Buffer,
  paying: boolean,
  settings: CardOption,
  workspace: Workspace,
  onProgress: (step: string) => void,
  userId: number | null,
  knownGuids?: KnownGuids,
  crossFileDedup?: CrossFileDedupState,
  requestId?: string,
  uploadIdentity?: UploadIdentityContext,
  cardLimit?: number,
  singleFileUpload: boolean = false,
  anonymousPassId?: number | null
): Promise<FileResult> {
  const packages: Package[] = [];
  const warnings: string[] = [];
  let cardsHeldBack: number | undefined;
  let emptyReason: EmptyDeckReason | undefined;
  let rescueCandidates: RescueCandidate[] | undefined;
  const filename = file.originalname;
  const key = file.key;

  if (isAnkiDeckFile(filename)) {
    throw new Error(
      `"${filename}" is already an Anki deck. 2anki converts source files like Notion HTML exports, not existing decks.`
    );
  }

  if (isAnkiAppExportXml(fileContents) || isXmlFile(filename)) {
    const result = await convertAnkiAppExportToApkg(
      filename,
      fileContents,
      workspace.location
    );
    packages.push(new Package(result.deckName, result.cardCount, 0, 0));
    if (result.skippedMediaOnlyCount > 0) {
      warnings.push(
        describeSkippedMediaOnlyCards(result.skippedMediaOnlyCount)
      );
    }
    return { packages, warnings };
  }

  if (isOpmlFile(filename) || isBrainstormsJsonFile(filename)) {
    const result = await convertMindmapFileToApkg(
      filename,
      fileContents,
      workspace.location
    );
    packages.push(new Package(result.deckName, result.cardCount, 0, 0));
    return { packages, warnings };
  }

  if (isKindleClippingsFile(filename)) {
    const result = await buildVocabDeckFromKindleClippings({
      file: { name: filename, contents: fileContents },
      settings,
      workspace,
    });
    packages.push(new Package(result.name, result.cardCount, 0, 0));
    return { packages, warnings };
  }

  if (isEpubFile(filename)) {
    const result = await buildVocabDeckFromEpub({
      file: { name: filename, contents: fileContents },
      settings,
      workspace,
    });
    packages.push(new Package(result.name, result.cardCount, 0, 0));
    return { packages, warnings };
  }

  const allowImageQuizHtmlToAnki =
    paying && settings.imageQuizHtmlToAnki && isImageFile(filename);
  const isValidSingleFile =
    isZipContentFileSupported(filename) ||
    isPPTFile(filename) ||
    allowImageQuizHtmlToAnki ||
    isDocxFile(filename);

  if (isValidSingleFile) {
    // The Pages option applies only when the upload is a single PDF. A
    // multi-file pick (local, Dropbox, or Drive) converts every file whole, and
    // the zip and Claude-zip paths never reach here, so a range there is
    // ignored too.
    const singleFile = [{ name: filename, contents: fileContents }];
    const rangedFiles = singleFileUpload
      ? await applyPdfPageRange(
          singleFile,
          settings.pdfPageRange,
          userId,
          workspace.location,
          filename
        )
      : singleFile;
    const d = await PrepareDeck({
      name: filename,
      files: rangedFiles,
      settings: processUploadedPdf(filename, settings),
      noLimits: paying,
      workspace,
      onProgress,
      userId,
      anonymousPassId,
      requestId,
      knownGuids,
      uploadIdentity,
      crossFileDedup,
      cardLimit,
    });

    if (d) {
      cardsHeldBack = d.cardsHeldBack;
      const singleFilePackage = new Package(
        d.name,
        d.cardCount ?? 0,
        d.mcqCount ?? 0,
        d.mcqSkippedCount ?? 0,
        d.droppedImageCount ?? 0,
        d.emptyBackCount ?? 0,
        d.parsePath
      );
      singleFilePackage.overSplit = detectOverSplit(
        (d.deck ?? []).flatMap((deck) => deck.cards.map((card) => card.name))
      );
      // PrepareDeck scores inside whichever branch ran, because the Claude
      // branch returns deck: [] and scoring from `deck` out here would measure
      // nothing on every AI conversion.
      singleFilePackage.engine = d.engine;
      singleFilePackage.score = d.score;
      singleFilePackage.inducedRule = d.inducedRule;
      singleFilePackage.guidEntries = d.guidEntries;
      singleFilePackage.uploadIdentityStats = d.uploadIdentityStats;
      singleFilePackage.expiredNotionImageCount =
        d.expiredNotionImageCount ?? 0;
      singleFilePackage.missingLocalImageCount = d.missingLocalImageCount ?? 0;
      singleFilePackage.plainTextFallbackImageCount =
        d.plainTextFallbackImageCount ?? 0;
      singleFilePackage.pdfPageCount = d.pdfPageCount;
      singleFilePackage.pdfFallbackMode = d.pdfFallbackMode;
      singleFilePackage.coloredTextPageCount = d.coloredTextPageCount ?? 0;
      singleFilePackage.cherrySkippedCount = d.cherrySkippedCount ?? 0;
      singleFilePackage.notionEmptyBackCount = d.notionEmptyBackCount ?? 0;
      packages.push(singleFilePackage);
      if (d.warning) warnings.push(d.warning);
      emptyReason = d.emptyReason;
      rescueCandidates = d.rescueCandidates;
    }
  } else if (isCompressedFile(filename) || isCompressedFile(key)) {
    const result = await getPackagesFromZip(
      fileContents,
      paying,
      settings,
      workspace,
      onProgress,
      userId,
      {
        knownGuids,
        uploadIdentity,
        requestId,
        crossFileDedup,
        cardLimit,
        anonymousPassId,
      }
    );
    packages.push(...result.packages);
    if (result.warnings) warnings.push(...result.warnings);
    cardsHeldBack = result.cardsHeldBack;
    emptyReason = result.emptyReason;
    rescueCandidates = result.rescueCandidates;
  }

  return { packages, warnings, cardsHeldBack, emptyReason, rescueCandidates };
}

// Files in one upload are independent conversions, so they can run side by
// side. An upload that includes a zip stays sequential: each zip already
// converts its own decks in parallel under the per-worker Python cap and sizes
// its in-memory extraction for one archive at a time, so two zips at once would
// exceed both budgets. AI uploads share one dedup state across the concurrent
// files, which absorb their cards synchronously as each file lands.
function canConvertInParallel(files: UploadedFile[]): boolean {
  return (
    files.length > 1 &&
    !files.some(
      (file) =>
        isCompressedFile(file.originalname) ||
        isCompressedFile(file.key) ||
        hasUnknownExtension(file.originalname)
    )
  );
}

async function convertInSequence(
  files: UploadedFile[],
  workspace: Workspace,
  convert: (file: UploadedFile, ws: Workspace) => Promise<FileResult>
): Promise<FileResult[]> {
  const results: FileResult[] = [];
  for (const file of files) {
    results.push(await convert(file, workspace));
  }
  return results;
}

// Each file gets its own workspace because CustomExporter writes
// deck_info.json at a fixed path. Decks are lifted back and results returned
// in upload order, so the output matches the sequential path. The first
// failure stops queued files from starting, and a restart outranks an
// ordinary failure so the upload is reported as interrupted.
async function convertInParallel(
  files: UploadedFile[],
  workspace: Workspace,
  convert: (file: UploadedFile, ws: Workspace) => Promise<FileResult>,
  concurrency: number
): Promise<FileResult[]> {
  const limit = pLimit(concurrency);
  const fileWorkspaces = files.map(() => Workspace.subdir(workspace.location));
  const failures = new Map<number, unknown>();
  const results = await Promise.all(
    files.map((file, index) =>
      limit(async (): Promise<FileResult | null> => {
        if (failures.size > 0) return null;
        try {
          return await convert(file, fileWorkspaces[index]);
        } catch (error) {
          failures.set(index, error);
          return null;
        }
      })
    )
  );
  if (failures.size > 0) {
    const inUploadOrder = [...failures.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, error]) => error);
    throw inUploadOrder.find(isWorkerTerminationError) ?? inUploadOrder[0];
  }
  for (const fileWorkspace of fileWorkspaces) {
    await liftDecksToParent(fileWorkspace, workspace);
  }
  return results.filter((result): result is FileResult => result != null);
}

async function doGenerationWork(
  task: UploadGenerationTask,
  onProgress: (step: string) => void
): Promise<{
  packages: Package[];
  warnings: string[];
  cardFingerprints?: string[];
  cardsHeldBack?: number;
  emptyReason?: EmptyDeckReason;
  rescueCandidates?: RescueCandidate[];
}> {
  const {
    paying,
    files,
    settings,
    workspace,
    enqueuedAt,
    userId,
    anonymousPassId,
    knownGuids,
    uploadIdentity,
    existingCardFingerprints,
    requestId,
    cardLimit,
  } = task;
  let packages: Package[] = [];
  const warnings: string[] = [];
  let cardsHeldBack = 0;
  const emptyReasons: EmptyDeckReason[] = [];
  const rescueCandidateSets: RescueCandidate[][] = [];

  console.info('[upload] tempfile dwell', {
    dwellMs: Date.now() - enqueuedAt,
    fileCount: files.length,
  });

  const dedupeAcrossDecks = shouldDedupeAcrossDecks(
    paying,
    settings,
    files,
    userId
  );
  const crossFileDedup =
    shouldDedupeAcrossFiles(paying, settings, files) || dedupeAcrossDecks
      ? createCrossFileDedupState(existingCardFingerprints ?? [])
      : undefined;

  const convert = (upload: UploadedFile, fileWorkspace: Workspace) => {
    const { file, contents } = asReadableUpload(
      upload,
      getFileContents(upload)
    );
    return processFile(
      file,
      contents,
      paying,
      settings,
      fileWorkspace,
      onProgress,
      userId,
      knownGuids,
      crossFileDedup,
      requestId,
      uploadIdentity,
      cardLimit,
      files.length === 1,
      anonymousPassId
    );
  };
  const concurrency =
    crossFileDedup == null ? resolvePerWorkerPythonCap() : AI_FILE_CONCURRENCY;
  const results = canConvertInParallel(files)
    ? await convertInParallel(files, workspace, convert, concurrency)
    : await convertInSequence(files, workspace, convert);

  for (const result of results) {
    packages = packages.concat(result.packages);
    warnings.push(...result.warnings);
    cardsHeldBack += result.cardsHeldBack ?? 0;
    if (result.emptyReason != null) emptyReasons.push(result.emptyReason);
    if (result.rescueCandidates != null) {
      rescueCandidateSets.push(result.rescueCandidates);
    }
  }

  // Only report a reason when the whole upload produced no cards. A reason from
  // one empty file in an otherwise successful upload would mislabel a success.
  const totalCards = packages.reduce((sum, p) => sum + (p.cardCount ?? 0), 0);
  const emptyReason =
    totalCards === 0 && emptyReasons.length > 0
      ? mostSpecificEmptyReason(emptyReasons)
      : undefined;
  const mergedRescue = mergeRescueCandidates(rescueCandidateSets);
  const rescueCandidates =
    totalCards === 0 && mergedRescue.length > 0 ? mergedRescue : undefined;

  const reportsCrossDeck =
    crossFileDedup != null && crossFileDedup.historicalKeys.size > 0;
  if (
    crossFileDedup &&
    (crossFileDedup.filesProcessed >= 2 || reportsCrossDeck)
  ) {
    track('ai_conversion_completed', {
      userId,
      props: {
        source_file_count: crossFileDedup.filesProcessed,
        cross_file_duplicates_suppressed: crossFileDedup.suppressed,
        cross_deck_duplicates_suppressed: crossFileDedup.crossDeckSuppressed,
        historical_cards_considered: crossFileDedup.historicalKeys.size,
      },
    });
  }

  const cardFingerprints =
    dedupeAcrossDecks && crossFileDedup
      ? collectNewFingerprints(crossFileDedup)
      : undefined;

  return {
    packages,
    warnings,
    cardFingerprints,
    cardsHeldBack: cardLimit != null ? cardsHeldBack : undefined,
    emptyReason,
    rescueCandidates,
  };
}

// ECONNRESET and ECONNABORTED read as a client hanging up downstream, which
// would hide a worker-side network fault from ops; they cross without fields.
const CLIENT_ABORT_CODES = new Set(['ECONNRESET', 'ECONNABORTED']);

// A filesystem or OS error (ENOENT, EACCES, ENOSPC) is told apart from a
// deliberate coded error by its numeric errno; only those two fields cross,
// so ErrorHandler can still answer it as our fault (#5144).
export function systemErrorOf(
  err: unknown
): { code: string; errno: number } | undefined {
  const { code, errno } = (err ?? {}) as { code?: unknown; errno?: unknown };
  if (
    typeof code === 'string' &&
    typeof errno === 'number' &&
    !CLIENT_ABORT_CODES.has(code)
  ) {
    return { code, errno };
  }
  return undefined;
}

export async function runUploadGenerationInWorker(
  task: UploadGenerationTask,
  onProgress: (step: string) => void = () => {}
): Promise<UploadGenerationResult> {
  try {
    const {
      packages,
      warnings,
      cardFingerprints,
      cardsHeldBack,
      emptyReason,
      rescueCandidates,
    } = await doGenerationWork(task, onProgress);
    return {
      ok: true,
      packages,
      warnings,
      cardFingerprints,
      cardsHeldBack,
      emptyReason,
      rescueCandidates,
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : undefined,
        stack: err instanceof Error ? err.stack : undefined,
        systemError: systemErrorOf(err),
        sourceFormat:
          err instanceof EmptyDeckError ? err.sourceFormat : undefined,
        reason: err instanceof EmptyDeckError ? err.reason : undefined,
        rescueCandidates:
          err instanceof EmptyDeckError ? err.rescueCandidates : undefined,
      },
    };
  } finally {
    // A job that made billable Claude calls and then failed still recorded
    // ai_usage_recorded rows; drain them on both the success and error paths
    // before the child is reused or torn down so that spend is never lost.
    try {
      await getEventsSink().flushDurable();
    } catch (flushError) {
      console.error(
        '[uploads] durable spend flush on worker exit failed',
        flushError
      );
    }
  }
}

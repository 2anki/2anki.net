import { UploadedFile } from '../../lib/storage/types';
import type { KnownGuids } from '../../lib/anki/guidLedgerTypes';
import CardOption from '../../lib/parser/Settings/CardOption';
import Package from '../../lib/parser/Package';
import fs from 'fs';
import { PrepareDeck } from '../../infrastracture/adapters/fileConversion/PrepareDeck';
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
import Workspace from '../../lib/parser/WorkSpace';
import { detectOverSplit } from '../../lib/parser/detectOverSplit';
import { isZipContentFileSupported } from './isZipContentFileSupported';
import {
  CrossFileDedupState,
  createCrossFileDedupState,
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
import { EmptyDeckError } from '../jobs/EmptyDeckError';
import {
  UploadGenerationResult,
  UploadGenerationTask,
} from './uploadGenerationTypes';

export function getFileContents(
  file: UploadedFile,
  enqueuedAt?: number
): Buffer {
  const readAt = Date.now();

  let result: Buffer;

  if (!file.path) {
    if (file.buffer == null) {
      throw new Error('Uploaded file has neither a path nor a buffer');
    }
    result = Buffer.from(file.buffer);
    console.info('[upload] tempfile dwell', {
      dwellMs: readAt - (enqueuedAt ?? readAt),
      mode: 'buffer',
      fileSizeBytes: result.byteLength,
    });
    return result;
  }

  try {
    if (fs.existsSync(file.path)) {
      result = fs.readFileSync(file.path);
      console.info('[upload] tempfile dwell', {
        dwellMs: readAt - (enqueuedAt ?? readAt),
        mode: 'disk',
        fileSizeBytes: result.byteLength,
      });
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
  console.info('[upload] tempfile dwell', {
    dwellMs: readAt - (enqueuedAt ?? readAt),
    mode: 'buffer-fallback',
    fileSizeBytes: result.byteLength,
  });
  return result;
}

interface FileResult {
  packages: Package[];
  warnings: string[];
}

export function countAiContentFiles(files: UploadedFile[]): number {
  return files.filter(
    (f) =>
      isZipContentFileSupported(f.originalname) || isPPTFile(f.originalname)
  ).length;
}

export function shouldDedupeAcrossFiles(
  paying: boolean,
  settings: CardOption,
  files: UploadedFile[]
): boolean {
  return (
    paying && settings.claudeAIFlashcards && countAiContentFiles(files) >= 2
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
  crossFileDedup?: CrossFileDedupState
): Promise<FileResult> {
  const packages: Package[] = [];
  const warnings: string[] = [];
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
    const d = await PrepareDeck({
      name: filename,
      files: [{ name: filename, contents: fileContents }],
      settings,
      noLimits: paying,
      workspace,
      onProgress,
      userId,
      knownGuids,
      crossFileDedup,
    });

    if (d) {
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
      singleFilePackage.expiredNotionImageCount =
        d.expiredNotionImageCount ?? 0;
      packages.push(singleFilePackage);
      if (d.warning) warnings.push(d.warning);
    }
  } else if (isCompressedFile(filename) || isCompressedFile(key)) {
    const result = await getPackagesFromZip(
      fileContents,
      paying,
      settings,
      workspace,
      onProgress,
      userId,
      knownGuids
    );
    packages.push(...result.packages);
    if (result.warnings) warnings.push(...result.warnings);
  }

  return { packages, warnings };
}

async function doGenerationWork(
  task: UploadGenerationTask,
  onProgress: (step: string) => void
): Promise<{ packages: Package[]; warnings: string[] }> {
  const { paying, files, settings, workspace, enqueuedAt, userId, knownGuids } =
    task;
  let packages: Package[] = [];
  const warnings: string[] = [];

  const crossFileDedup = shouldDedupeAcrossFiles(paying, settings, files)
    ? createCrossFileDedupState()
    : undefined;

  for (const file of files) {
    const fileContents = getFileContents(file, enqueuedAt);
    const result = await processFile(
      file,
      fileContents,
      paying,
      settings,
      workspace,
      onProgress,
      userId,
      knownGuids,
      crossFileDedup
    );
    packages = packages.concat(result.packages);
    warnings.push(...result.warnings);
  }

  if (crossFileDedup && crossFileDedup.filesProcessed >= 2) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { track } = require('../../services/events/track');
    track('ai_conversion_completed', {
      userId,
      props: {
        source_file_count: crossFileDedup.filesProcessed,
        cross_file_duplicates_suppressed: crossFileDedup.suppressed,
      },
    });
  }

  return { packages, warnings };
}

export async function runUploadGenerationInWorker(
  task: UploadGenerationTask
): Promise<UploadGenerationResult> {
  const onProgress = (step: string) => {
    task.progressPort?.postMessage(step);
  };
  try {
    const { packages, warnings } = await doGenerationWork(task, onProgress);
    return { ok: true, packages, warnings };
  } catch (err) {
    return {
      ok: false,
      error: {
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : undefined,
        sourceFormat:
          err instanceof EmptyDeckError ? err.sourceFormat : undefined,
      },
    };
  } finally {
    task.progressPort?.close();
  }
}

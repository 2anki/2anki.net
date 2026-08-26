import fs from 'node:fs';
import { MessageChannel } from 'node:worker_threads';
import type { KnownGuids } from '../../lib/anki/guidLedgerTypes';
import Package from '../../lib/parser/Package';
import CardOption from '../../lib/parser/Settings/CardOption';
import { UploadedFile } from '../../lib/storage/types';
import Workspace from '../../lib/parser/WorkSpace';
import { EmptyDeckError } from '../jobs/EmptyDeckError';
import { runUploadGeneration } from '../../lib/conversionPool';
import { UploadGenerationFailure } from './uploadGenerationTypes';
import { ensureUploadBytes } from './ensureUploadBytes';
import { UploadFileUnavailableError } from './UploadFileUnavailableError';

function findUnavailableUpload(
  files: UploadedFile[]
): UploadedFile | undefined {
  return files.find(
    (file) =>
      file.buffer == null &&
      file.path != null &&
      file.path !== '' &&
      !fs.existsSync(file.path)
  );
}

export interface PackageResult {
  packages: Package[];
  warnings?: string[];
}

function buildWorkerError(failure: UploadGenerationFailure): Error {
  if (failure.name === 'EmptyDeckError') {
    return new EmptyDeckError(failure.sourceFormat);
  }
  if (failure.message != null && failure.message.trim() !== '') {
    const e = new Error(failure.message);
    if (failure.name != null) {
      e.name = failure.name;
    }
    return e;
  }
  const fallback = new Error(
    'Upload worker reported an error without a message'
  ) as Error & { code: string };
  fallback.code = 'PARSER_CRASH';
  if (failure.name != null) {
    fallback.name = failure.name;
  }
  return fallback;
}

export interface GenerationContext {
  knownGuids?: KnownGuids;
  requestId?: string;
}

class GeneratePackagesUseCase {
  async execute(
    paying: boolean,
    files: UploadedFile[],
    settings: CardOption,
    workspace: Workspace,
    onProgress?: (step: string) => void,
    userId: number | null = null,
    context: GenerationContext = {}
  ): Promise<PackageResult> {
    const { knownGuids, requestId } = context;
    ensureUploadBytes(files);
    const unavailable = findUnavailableUpload(files);
    if (unavailable) {
      throw new UploadFileUnavailableError(unavailable.originalname);
    }
    const enqueuedAt = Date.now();
    const channel = onProgress ? new MessageChannel() : null;
    channel?.port1.on('message', (step: string) => onProgress?.(step));
    try {
      const result = await runUploadGeneration(
        {
          paying,
          files,
          settings,
          workspace,
          enqueuedAt,
          userId,
          knownGuids,
          requestId,
          progressPort: channel?.port2,
        },
        channel ? [channel.port2] : undefined
      );
      if (result.ok) {
        return { packages: result.packages, warnings: result.warnings };
      }
      throw buildWorkerError(result.error);
    } finally {
      channel?.port1.close();
    }
  }
}

export default GeneratePackagesUseCase;

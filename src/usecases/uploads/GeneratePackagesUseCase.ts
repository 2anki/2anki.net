import fs from 'node:fs';
import {
  isRescueCandidate,
  type RescueCandidate,
} from '../../types/RescueCandidate';
import type { KnownGuids } from '../../lib/anki/guidLedgerTypes';
import type { UploadIdentityContext } from '../../lib/parser/DeckParser';
import Package from '../../lib/parser/Package';
import CardOption from '../../lib/parser/Settings/CardOption';
import { UploadedFile } from '../../lib/storage/types';
import Workspace from '../../lib/parser/WorkSpace';
import { EmptyDeckError, EmptyDeckReason } from '../jobs/EmptyDeckError';
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
  cardFingerprints?: string[];
  cardsHeldBack?: number;
  emptyReason?: EmptyDeckReason;
  rescueCandidates?: RescueCandidate[];
}

function buildWorkerError(failure: UploadGenerationFailure): Error {
  if (failure.name === 'EmptyDeckError') {
    return new EmptyDeckError(
      failure.sourceFormat,
      failure.reason,
      (failure.rescueCandidates ?? []).filter(isRescueCandidate)
    );
  }
  if (failure.message != null && failure.message.trim() !== '') {
    const e = new Error(failure.message);
    if (failure.name != null) {
      e.name = failure.name;
    }
    // The frame that threw lives in the worker; without its stack every
    // crash log points here instead (#5137).
    if (failure.stack != null) {
      e.stack = failure.stack;
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
  if (failure.stack != null) {
    fallback.stack = failure.stack;
  }
  return fallback;
}

export interface GenerationContext {
  knownGuids?: KnownGuids;
  uploadIdentity?: UploadIdentityContext;
  existingCardFingerprints?: string[];
  requestId?: string;
  cardLimit?: number;
  anonymousPassId?: number | null;
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
    const {
      knownGuids,
      uploadIdentity,
      existingCardFingerprints,
      requestId,
      cardLimit,
      anonymousPassId,
    } = context;
    ensureUploadBytes(files);
    const unavailable = findUnavailableUpload(files);
    if (unavailable) {
      throw new UploadFileUnavailableError(unavailable.originalname);
    }
    const enqueuedAt = Date.now();
    const result = await runUploadGeneration(
      {
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
      },
      onProgress
    );
    if (result.ok) {
      return {
        packages: result.packages,
        warnings: result.warnings,
        cardFingerprints: result.cardFingerprints,
        cardsHeldBack: result.cardsHeldBack,
        emptyReason: result.emptyReason,
        rescueCandidates: result.rescueCandidates,
      };
    }
    throw buildWorkerError(result.error);
  }
}

export default GeneratePackagesUseCase;

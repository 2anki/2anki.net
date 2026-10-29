import type { KnownGuids } from '../../lib/anki/guidLedgerTypes';
import type { RescueCandidate } from '../../types/RescueCandidate';
import type { UploadIdentityContext } from '../../lib/parser/DeckParser';
import type Package from '../../lib/parser/Package';
import type CardOption from '../../lib/parser/Settings/CardOption';
import type Workspace from '../../lib/parser/WorkSpace';
import type { UploadedFile } from '../../lib/storage/types';
import type { EmptyDeckReason } from '../jobs/EmptyDeckError';

export interface UploadGenerationTask {
  paying: boolean;
  files: UploadedFile[];
  settings: CardOption;
  workspace: Workspace;
  enqueuedAt: number;
  userId: number | null;
  anonymousPassId?: number | null;
  knownGuids?: KnownGuids;
  uploadIdentity?: UploadIdentityContext;
  existingCardFingerprints?: string[];
  requestId?: string;
  cardLimit?: number;
}

export interface UploadGenerationFailure {
  message?: string;
  name?: string;
  stack?: string;
  systemError?: { code: string; errno: number };
  sourceFormat?: 'markdown';
  reason?: EmptyDeckReason;
  rescueCandidates?: RescueCandidate[];
}

export type UploadGenerationResult =
  | {
      ok: true;
      packages: Package[];
      warnings: string[];
      cardFingerprints?: string[];
      cardsHeldBack?: number;
      emptyReason?: EmptyDeckReason;
      rescueCandidates?: RescueCandidate[];
    }
  | { ok: false; error: UploadGenerationFailure };

export const UPLOAD_GENERATION_TASK = 'uploadGeneration';

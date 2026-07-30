import type { MessagePort } from 'node:worker_threads';
import type { KnownGuids } from '../../lib/anki/guidLedgerTypes';
import type Package from '../../lib/parser/Package';
import type CardOption from '../../lib/parser/Settings/CardOption';
import type Workspace from '../../lib/parser/WorkSpace';
import type { UploadedFile } from '../../lib/storage/types';

export interface UploadGenerationTask {
  paying: boolean;
  files: UploadedFile[];
  settings: CardOption;
  workspace: Workspace;
  enqueuedAt: number;
  userId: number | null;
  knownGuids?: KnownGuids;
  progressPort?: MessagePort;
}

export interface UploadGenerationFailure {
  message?: string;
  name?: string;
  sourceFormat?: 'markdown';
}

export type UploadGenerationResult =
  | { ok: true; packages: Package[]; warnings: string[] }
  | { ok: false; error: UploadGenerationFailure };

export const UPLOAD_GENERATION_TASK = 'uploadGeneration';

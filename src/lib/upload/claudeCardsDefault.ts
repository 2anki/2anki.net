import { isPDFFile, isPPTFile } from '../storage/checks';

// Written by every signed-in AI toggle on the web from this change on. A stored
// claude-ai-flashcards off without it may still be a choice made before toggles
// were recorded (about half of recorded toggles are offs), so only an account
// value never stored or a latest recorded "on" lets the default apply. The
// account value decides, not the browser's, so the upload badge (which reads
// the account) and the upload agree.
export const AI_CHOICE_AT_KEY = 'ai-choice-at';

const AI_TURNED_ON_EVENT = 'upload_ai_turned_on';
const AI_TURNED_OFF_EVENT = 'upload_ai_turned_off';

export interface AiChoiceHistoryReader {
  latestAiToggleEventName(userId: number): Promise<string | null>;
}

export type UploadEntry = 'web' | 'mcp' | 'app';

export interface ClaudeDefaultCandidate {
  ownerId: number | null;
  paying: boolean;
  entry: UploadEntry;
  fileNames: readonly string[];
  options: Record<string, unknown>;
  storedOptions: unknown;
}

function isPdfOrSlidesUpload(fileNames: readonly string[]): boolean {
  return (
    fileNames.length > 0 &&
    fileNames.every(
      (name) => isPDFFile(name) != null || isPPTFile(name) != null
    )
  );
}

function hasAiChoiceMarker(options: Record<string, unknown>): boolean {
  const marker = options[AI_CHOICE_AT_KEY];
  return typeof marker === 'string' && marker !== '';
}

function aiSettingLeftAtDefault(options: Record<string, unknown>): boolean {
  return (
    options['claude-ai-flashcards'] !== 'true' &&
    options['pdf-page-pairs'] !== 'true' &&
    !hasAiChoiceMarker(options)
  );
}

function aiSettingNeverStored(options: Record<string, unknown>): boolean {
  const value = options['claude-ai-flashcards'];
  return value == null || value === '';
}

async function defaultMayApply(
  reader: AiChoiceHistoryReader,
  userId: number,
  options: Record<string, unknown>
): Promise<boolean> {
  let latest: string | null;
  try {
    latest = await reader.latestAiToggleEventName(userId);
  } catch (error) {
    console.warn(
      '[claude-default] toggle history read failed, keeping AI off',
      error
    );
    return false;
  }
  if (latest === AI_TURNED_OFF_EVENT) return false;
  if (latest === AI_TURNED_ON_EVENT) return true;
  return aiSettingNeverStored(options);
}

export async function claudeCardsByDefault(
  candidate: ClaudeDefaultCandidate,
  reader: AiChoiceHistoryReader
): Promise<boolean> {
  if (
    candidate.ownerId == null ||
    !candidate.paying ||
    candidate.entry !== 'web' ||
    !isPdfOrSlidesUpload(candidate.fileNames) ||
    !aiSettingLeftAtDefault(candidate.options)
  ) {
    return false;
  }
  return defaultMayApply(
    reader,
    candidate.ownerId,
    storedOptionsOf(candidate.storedOptions)
  );
}

function storedOptionsOf(stored: unknown): Record<string, unknown> {
  if (stored == null || typeof stored !== 'object' || Array.isArray(stored)) {
    return {};
  }
  return stored as Record<string, unknown>;
}

export async function accountHasClaudeCardsByDefault(
  userId: number,
  paying: boolean,
  storedCardOptions: unknown,
  reader: AiChoiceHistoryReader
): Promise<boolean> {
  const stored = storedOptionsOf(storedCardOptions);
  if (!paying || !aiSettingLeftAtDefault(stored)) {
    return false;
  }
  return defaultMayApply(reader, userId, stored);
}

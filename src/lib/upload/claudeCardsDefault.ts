import { isPDFFile, isPPTFile } from '../storage/checks';

// Written by every signed-in AI toggle on the web from this change on. A stored
// claude-ai-flashcards value without it cannot be told apart from one copied
// in from an old browser, so only this marker or a recorded toggle event
// counts as the person having chosen.
export const AI_CHOICE_AT_KEY = 'ai-choice-at';

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

async function aiOffWasRecorded(
  reader: AiChoiceHistoryReader,
  userId: number
): Promise<boolean> {
  try {
    return (
      (await reader.latestAiToggleEventName(userId)) === AI_TURNED_OFF_EVENT
    );
  } catch (error) {
    console.warn(
      '[claude-default] toggle history read failed, keeping AI off',
      error
    );
    return true;
  }
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
  return !(await aiOffWasRecorded(reader, candidate.ownerId));
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
  if (!paying || !aiSettingLeftAtDefault(storedOptionsOf(storedCardOptions))) {
    return false;
  }
  return !(await aiOffWasRecorded(reader, userId));
}

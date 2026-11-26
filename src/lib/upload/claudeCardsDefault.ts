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
  giftPays?: () => Promise<boolean>;
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

// An account with no plan reaches the default only while the free AI gift
// would pay for this upload. The gift is read last, so an upload the rule
// leaves alone never pays for that read; a failed read keeps AI off.
async function aiPaidFor(candidate: ClaudeDefaultCandidate): Promise<boolean> {
  if (candidate.paying) return true;
  if (candidate.giftPays == null) return false;
  try {
    return await candidate.giftPays();
  } catch (error) {
    console.warn('[claude-default] gift read failed, keeping AI off', error);
    return false;
  }
}

export async function claudeCardsByDefault(
  candidate: ClaudeDefaultCandidate,
  reader: AiChoiceHistoryReader
): Promise<boolean> {
  if (
    candidate.ownerId == null ||
    candidate.entry !== 'web' ||
    !isPdfOrSlidesUpload(candidate.fileNames) ||
    !aiSettingLeftAtDefault(candidate.options) ||
    !(await aiPaidFor(candidate))
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

// Whether the account's own record leaves Claude on: off only when the person
// chose against it (a stored off carrying the choice marker, or a latest
// toggle off). A stored off with neither is what the settings sync writes for
// an account that never touched an AI control, so it is not a choice. The
// upload card's switch starts from this; it never decides an upload, which
// only the switch's sent value does.
export async function accountChoiceAllowsClaude(
  userId: number,
  storedCardOptions: unknown,
  reader: AiChoiceHistoryReader
): Promise<boolean> {
  const stored = storedOptionsOf(storedCardOptions);
  if (stored['claude-ai-flashcards'] === 'true') return true;
  if (hasAiChoiceMarker(stored)) return false;
  try {
    return (
      (await reader.latestAiToggleEventName(userId)) !== AI_TURNED_OFF_EVENT
    );
  } catch (error) {
    console.warn(
      '[claude-default] toggle history read failed, keeping the switch off',
      error
    );
    return false;
  }
}

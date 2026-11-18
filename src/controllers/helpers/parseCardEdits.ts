import type {
  CardEdit,
  FieldEdit,
} from '../../usecases/apkg/PackEditedApkgUseCase';

export const STALE_PREVIEW_MESSAGE =
  'This preview is out of date. Reload the page and make your edits again.';
export const INVALID_EDITS_MESSAGE =
  "These edits couldn't be read. Reload the page and try again.";

export const MAX_EDITS = 100_000;
export const MAX_FIELD_VALUE_LENGTH = 100_000;
const MAX_FIELD_EDITS_PER_CARD = 2;
const MAX_FIELD_INDEX = 1_000;

export type ParsedCardEdits =
  | { ok: true; edits: CardEdit[] }
  | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function parseFieldEdit(raw: unknown): FieldEdit | null {
  if (!isRecord(raw)) return null;
  const { index, value } = raw;
  if (
    typeof index !== 'number' ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > MAX_FIELD_INDEX
  ) {
    return null;
  }
  if (typeof value !== 'string' || value.length > MAX_FIELD_VALUE_LENGTH) {
    return null;
  }
  return { index, value };
}

function parseFieldEdits(raw: unknown): FieldEdit[] | null | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_FIELD_EDITS_PER_CARD) return null;
  const fields: FieldEdit[] = [];
  for (const entry of raw) {
    const field = parseFieldEdit(entry);
    if (field == null) return null;
    fields.push(field);
  }
  return fields;
}

function parseCardEdit(raw: Record<string, unknown>): CardEdit | null {
  const { cardId, deleted, suspended } = raw;
  if (
    typeof cardId !== 'number' ||
    !Number.isSafeInteger(cardId) ||
    cardId <= 0
  ) {
    return null;
  }
  if (!isOptionalBoolean(deleted) || !isOptionalBoolean(suspended)) {
    return null;
  }
  const fields = parseFieldEdits(raw.fields);
  if (fields === null) return null;
  const edit: CardEdit = { cardId };
  if (fields !== undefined) edit.fields = fields;
  if (deleted !== undefined) edit.deleted = deleted;
  if (suspended !== undefined) edit.suspended = suspended;
  return edit;
}

export function parseCardEdits(raw: unknown): ParsedCardEdits {
  if (!Array.isArray(raw) || raw.length > MAX_EDITS) {
    return { ok: false, message: INVALID_EDITS_MESSAGE };
  }
  const edits: CardEdit[] = [];
  for (const entry of raw) {
    if (isRecord(entry) && entry.cardId === undefined && 'cardIndex' in entry) {
      return { ok: false, message: STALE_PREVIEW_MESSAGE };
    }
    const edit = isRecord(entry) ? parseCardEdit(entry) : null;
    if (edit == null) return { ok: false, message: INVALID_EDITS_MESSAGE };
    edits.push(edit);
  }
  return { ok: true, edits };
}

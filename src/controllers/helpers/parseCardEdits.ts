import {
  type CardEdit,
  type FieldEdit,
  hasFieldBreakingCharacter,
} from '../../usecases/apkg/PackEditedApkgUseCase';

export const STALE_PREVIEW_MESSAGE =
  'This preview is out of date. Reload the page and make your edits again.';
export const INVALID_EDITS_MESSAGE =
  "These edits couldn't be read. Reload the page and try again.";
export const FIELD_TOO_LONG_MESSAGE =
  'One of the edited fields is too long. Shorten it and try again.';
export const EDITS_TOO_LONG_MESSAGE =
  'The edited fields are too long to download together. Shorten some and try again.';

export const MAX_EDITS = 100_000;
export const MAX_FIELD_VALUE_LENGTH = 2_000_000;
export const MAX_TOTAL_FIELD_LENGTH = 12_000_000;
const MAX_FIELD_EDITS_PER_CARD = 2;
const MAX_FIELD_INDEX = 1_000;

export type ParsedCardEdits =
  | { ok: true; edits: CardEdit[] }
  | { ok: false; message: string };

interface Refusal {
  refused: string;
}

function isRefusal(value: unknown): value is Refusal {
  return isRecord(value) && typeof value.refused === 'string';
}

const INVALID: Refusal = { refused: INVALID_EDITS_MESSAGE };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function parseFieldEdit(raw: unknown): FieldEdit | Refusal {
  if (!isRecord(raw)) return INVALID;
  const { index, value } = raw;
  if (
    typeof index !== 'number' ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > MAX_FIELD_INDEX
  ) {
    return INVALID;
  }
  if (typeof value !== 'string' || hasFieldBreakingCharacter(value)) {
    return INVALID;
  }
  if (value.length > MAX_FIELD_VALUE_LENGTH) {
    return { refused: FIELD_TOO_LONG_MESSAGE };
  }
  return { index, value };
}

function parseFieldEdits(raw: unknown): FieldEdit[] | Refusal | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_FIELD_EDITS_PER_CARD) {
    return INVALID;
  }
  const fields: FieldEdit[] = [];
  for (const entry of raw) {
    const field = parseFieldEdit(entry);
    if (isRefusal(field)) return field;
    fields.push(field);
  }
  return fields;
}

function parseCardEdit(raw: Record<string, unknown>): CardEdit | Refusal {
  const { cardId, deleted } = raw;
  if (
    typeof cardId !== 'number' ||
    !Number.isSafeInteger(cardId) ||
    cardId <= 0
  ) {
    return INVALID;
  }
  if (!isOptionalBoolean(deleted)) {
    return INVALID;
  }
  const fields = parseFieldEdits(raw.fields);
  if (isRefusal(fields)) return fields;
  const edit: CardEdit = { cardId };
  if (fields !== undefined) edit.fields = fields;
  if (deleted !== undefined) edit.deleted = deleted;
  return edit;
}

function totalFieldLength(edits: CardEdit[]): number {
  return edits.reduce(
    (sum, edit) =>
      sum +
      (edit.fields ?? []).reduce(
        (inner, field) => inner + field.value.length,
        0
      ),
    0
  );
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
    const edit = isRecord(entry) ? parseCardEdit(entry) : INVALID;
    if (isRefusal(edit)) return { ok: false, message: edit.refused };
    edits.push(edit);
  }
  if (totalFieldLength(edits) > MAX_TOTAL_FIELD_LENGTH) {
    return { ok: false, message: EDITS_TOO_LONG_MESSAGE };
  }
  return { ok: true, edits };
}

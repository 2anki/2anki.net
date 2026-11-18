export interface CardEditState {
  fields?: Record<number, string>;
  deleted?: boolean;
  suspended?: boolean;
}

export interface EditPayload {
  cardId: number;
  fields?: Array<{ index: number; value: string }>;
  deleted?: boolean;
  suspended?: boolean;
}

function hasFieldEdits(state: CardEditState): boolean {
  return state.fields != null && Object.keys(state.fields).length > 0;
}

export function isEmptyEdit(state: CardEditState): boolean {
  return !state.deleted && !state.suspended && !hasFieldEdits(state);
}

export function withEditMapEntry(
  editMap: Map<number, CardEditState>,
  cardId: number,
  state: CardEditState
): Map<number, CardEditState> {
  const previous = editMap.get(cardId);
  const next = new Map(editMap);
  if (previous == null || !sameFields(previous.fields, state.fields)) {
    next.delete(cardId);
  }
  if (isEmptyEdit(state)) {
    next.delete(cardId);
  } else {
    next.set(cardId, state);
  }
  return next;
}

function sameFields(
  a: Record<number, string> | undefined,
  b: Record<number, string> | undefined
): boolean {
  const left = Object.entries(a ?? {});
  const right = b ?? {};
  return (
    left.length === Object.keys(right).length &&
    left.every(([index, value]) => right[Number(index)] === value)
  );
}

const FIELD_BREAKING_CHARACTERS = [
  String.fromCharCode(0x1f),
  String.fromCharCode(0),
];

export function withoutFieldBreakingCharacters(draft: string): string {
  return FIELD_BREAKING_CHARACTERS.reduce(
    (text, character) => text.replaceAll(character, ''),
    draft
  );
}

export function withFieldDraft(
  state: CardEditState | undefined,
  fieldIndex: number,
  original: string,
  draft: string
): CardEditState {
  const fields = { ...state?.fields };
  if (draft === original) {
    delete fields[fieldIndex];
  } else {
    fields[fieldIndex] = draft;
  }
  return { ...state, fields };
}

export function toEditPayloads(
  editMap: Map<number, CardEditState>
): EditPayload[] {
  return Array.from(editMap.entries()).map(([cardId, state]) => {
    const payload: EditPayload = { cardId };
    if (hasFieldEdits(state)) {
      payload.fields = Object.entries(state.fields ?? {}).map(
        ([index, value]) => ({ index: Number(index), value })
      );
    }
    if (state.deleted) payload.deleted = true;
    if (state.suspended) payload.suspended = true;
    return payload;
  });
}

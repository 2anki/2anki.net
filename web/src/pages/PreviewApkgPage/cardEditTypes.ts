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
  const next = new Map(editMap);
  if (isEmptyEdit(state)) {
    next.delete(cardId);
  } else {
    next.set(cardId, state);
  }
  return next;
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

import { describe, expect, it } from 'vitest';
import {
  CardEditState,
  toEditPayloads,
  withEditMapEntry,
  withFieldDraft,
} from './cardEditTypes';

describe('withFieldDraft', () => {
  it('records a draft that differs from the stored value', () => {
    expect(withFieldDraft(undefined, 1, 'stored', 'typed')).toEqual({
      fields: { 1: 'typed' },
    });
  });

  it('removes the field when the draft equals the stored value', () => {
    expect(
      withFieldDraft({ fields: { 0: 'a', 1: 'b' } }, 1, 'stored', 'stored')
    ).toEqual({ fields: { 0: 'a' } });
  });
});

describe('withEditMapEntry', () => {
  it('drops a card whose state no longer changes anything', () => {
    const before = new Map<number, CardEditState>([[7, { deleted: true }]]);

    const after = withEditMapEntry(before, 7, {
      deleted: false,
      suspended: false,
      fields: {},
    });

    expect([...after.keys()]).toEqual([]);
  });

  it('keeps other cards when one changes', () => {
    const before = new Map<number, CardEditState>([[7, { deleted: true }]]);

    const after = withEditMapEntry(before, 9, { suspended: true });

    expect([...after.entries()]).toEqual([
      [7, { deleted: true }],
      [9, { suspended: true }],
    ]);
  });
});

describe('toEditPayloads', () => {
  it('sends card ids with field indices and only the flags that are set', () => {
    const editMap = new Map<number, CardEditState>([
      [1700000000123, { fields: { 1: 'new back' }, deleted: false }],
      [1700000000124, { deleted: true }],
      [1700000000125, { suspended: true, fields: {} }],
    ]);

    expect(toEditPayloads(editMap)).toEqual([
      { cardId: 1700000000123, fields: [{ index: 1, value: 'new back' }] },
      { cardId: 1700000000124, deleted: true },
      { cardId: 1700000000125, suspended: true },
    ]);
  });
});

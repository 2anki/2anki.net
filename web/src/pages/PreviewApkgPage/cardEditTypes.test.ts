import { describe, expect, it } from 'vitest';
import {
  CardEditState,
  toEditPayloads,
  withEditMapEntry,
  withFieldDraft,
  withoutFieldBreakingCharacters,
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
      fields: {},
    });

    expect([...after.keys()]).toEqual([]);
  });

  it('moves a card it changes again to the end, so its edit is applied last', () => {
    const before = new Map<number, CardEditState>([
      [200, { fields: { 0: 'from card 1' } }],
      [201, { fields: { 0: 'from card 2' } }],
    ]);

    const after = withEditMapEntry(before, 200, {
      fields: { 0: 'from card 1, again' },
    });

    expect(toEditPayloads(after).map((payload) => payload.cardId)).toEqual([
      201, 200,
    ]);
  });

  it('keeps a card in place when only its delete flag changes', () => {
    let editMap = new Map<number, CardEditState>();
    editMap = withEditMapEntry(editMap, 200, { fields: { 0: 'from card 1' } });
    editMap = withEditMapEntry(editMap, 201, { fields: { 0: 'from card 2' } });
    editMap = withEditMapEntry(editMap, 200, {
      fields: { 0: 'from card 1' },
      deleted: true,
    });

    expect(toEditPayloads(editMap)).toEqual([
      {
        cardId: 200,
        fields: [{ index: 0, value: 'from card 1' }],
        deleted: true,
      },
      { cardId: 201, fields: [{ index: 0, value: 'from card 2' }] },
    ]);
  });

  it('keeps other cards when one changes', () => {
    const before = new Map<number, CardEditState>([[7, { deleted: true }]]);

    const after = withEditMapEntry(before, 9, { fields: { 0: 'edited' } });

    expect([...after.entries()]).toEqual([
      [7, { deleted: true }],
      [9, { fields: { 0: 'edited' } }],
    ]);
  });
});

describe('withoutFieldBreakingCharacters', () => {
  it('removes the field separator and NUL and keeps everything else', () => {
    const pasted = `one${String.fromCharCode(0x1f)}two${String.fromCharCode(0)}<br>&nbsp;\tthree`;

    expect(withoutFieldBreakingCharacters(pasted)).toBe(
      'onetwo<br>&nbsp;\tthree'
    );
  });
});

describe('toEditPayloads', () => {
  it('sends card ids with field indices and only the flags that are set', () => {
    const editMap = new Map<number, CardEditState>([
      [1700000000123, { fields: { 1: 'new back' }, deleted: false }],
      [1700000000124, { deleted: true, fields: {} }],
    ]);

    expect(toEditPayloads(editMap)).toEqual([
      { cardId: 1700000000123, fields: [{ index: 1, value: 'new back' }] },
      { cardId: 1700000000124, deleted: true },
    ]);
  });
});

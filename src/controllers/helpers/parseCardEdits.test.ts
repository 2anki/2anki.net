import {
  INVALID_EDITS_MESSAGE,
  MAX_FIELD_VALUE_LENGTH,
  parseCardEdits,
  STALE_PREVIEW_MESSAGE,
} from './parseCardEdits';

describe('parseCardEdits', () => {
  it('accepts edits identified by card id', () => {
    const edits = [
      { cardId: 1700000000123, fields: [{ index: 1, value: 'new back' }] },
      { cardId: 1700000000124, deleted: true },
      { cardId: 1700000000125, suspended: true },
    ];

    expect(parseCardEdits(edits)).toEqual({ ok: true, edits });
  });

  it('accepts an empty list', () => {
    expect(parseCardEdits([])).toEqual({ ok: true, edits: [] });
  });

  it('drops keys it does not know', () => {
    expect(
      parseCardEdits([{ cardId: 5, deleted: false, extra: 'ignored' }])
    ).toEqual({ ok: true, edits: [{ cardId: 5, deleted: false }] });
  });

  it('refuses the positional shape an older page sends', () => {
    expect(parseCardEdits([{ cardIndex: 0, front: 'x' }])).toEqual({
      ok: false,
      message: STALE_PREVIEW_MESSAGE,
    });
  });

  it.each([
    ['a non-array', { cardId: 1 }],
    ['a non-object entry', [5]],
    ['a fractional card id', [{ cardId: 1.5 }]],
    ['a negative card id', [{ cardId: -1 }]],
    ['an unsafe card id', [{ cardId: Number.MAX_SAFE_INTEGER + 2 }]],
    ['a string card id', [{ cardId: '5' }]],
    ['a non-boolean deleted', [{ cardId: 5, deleted: 'yes' }]],
    ['a non-boolean suspended', [{ cardId: 5, suspended: 1 }]],
    ['fields that are not a list', [{ cardId: 5, fields: { index: 0 } }]],
    [
      'a fractional field index',
      [{ cardId: 5, fields: [{ index: 0.5, value: '' }] }],
    ],
    [
      'a negative field index',
      [{ cardId: 5, fields: [{ index: -1, value: '' }] }],
    ],
    ['a non-string value', [{ cardId: 5, fields: [{ index: 0, value: 3 }] }]],
    [
      'a value over the length limit',
      [
        {
          cardId: 5,
          fields: [{ index: 0, value: 'x'.repeat(MAX_FIELD_VALUE_LENGTH + 1) }],
        },
      ],
    ],
    [
      'more field edits than a card has sides',
      [
        {
          cardId: 5,
          fields: [
            { index: 0, value: 'a' },
            { index: 1, value: 'b' },
            { index: 2, value: 'c' },
          ],
        },
      ],
    ],
  ])('refuses %s', (_label, raw) => {
    expect(parseCardEdits(raw)).toEqual({
      ok: false,
      message: INVALID_EDITS_MESSAGE,
    });
  });

  it('accepts a value exactly at the length limit', () => {
    const value = 'x'.repeat(MAX_FIELD_VALUE_LENGTH);

    expect(
      parseCardEdits([{ cardId: 5, fields: [{ index: 0, value }] }])
    ).toEqual({
      ok: true,
      edits: [{ cardId: 5, fields: [{ index: 0, value }] }],
    });
  });
});

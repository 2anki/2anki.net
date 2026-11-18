import {
  EDITS_TOO_LONG_MESSAGE,
  FIELD_TOO_LONG_MESSAGE,
  INVALID_EDITS_MESSAGE,
  MAX_FIELD_VALUE_LENGTH,
  MAX_TOTAL_FIELD_LENGTH,
  parseCardEdits,
  STALE_PREVIEW_MESSAGE,
} from './parseCardEdits';

describe('parseCardEdits', () => {
  it('accepts edits identified by card id', () => {
    const edits = [
      { cardId: 1700000000123, fields: [{ index: 1, value: 'new back' }] },
      { cardId: 1700000000124, deleted: true },
    ];

    expect(parseCardEdits(edits)).toEqual({ ok: true, edits });
  });

  it.each([true, false, 1])(
    'ignores a suspended flag of %s that an older page still sends',
    (suspended) => {
      expect(
        parseCardEdits([
          { cardId: 5, suspended },
          { cardId: 6, deleted: true, suspended },
        ])
      ).toEqual({
        ok: true,
        edits: [{ cardId: 5 }, { cardId: 6, deleted: true }],
      });
    }
  );

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
      'a value holding the field separator',
      [
        {
          cardId: 5,
          fields: [
            { index: 0, value: `evil${String.fromCharCode(0x1f)}shifted` },
          ],
        },
      ],
    ],
    [
      'a value holding a NUL character',
      [
        {
          cardId: 5,
          fields: [{ index: 0, value: `a${String.fromCharCode(0)}b` }],
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

  it('names a value over the per-field limit', () => {
    const value = 'x'.repeat(MAX_FIELD_VALUE_LENGTH + 1);

    expect(
      parseCardEdits([{ cardId: 5, fields: [{ index: 0, value }] }])
    ).toEqual({ ok: false, message: FIELD_TOO_LONG_MESSAGE });
  });

  it('names edits whose fields together pass the total limit', () => {
    const value = 'x'.repeat(MAX_FIELD_VALUE_LENGTH);
    const cards =
      Math.floor(MAX_TOTAL_FIELD_LENGTH / MAX_FIELD_VALUE_LENGTH) + 1;
    const edits = Array.from({ length: cards }, (_, i) => ({
      cardId: i + 1,
      fields: [{ index: 0, value }],
    }));

    expect(parseCardEdits(edits)).toEqual({
      ok: false,
      message: EDITS_TOO_LONG_MESSAGE,
    });
  });

  it('keeps the limits inside the 50 MB request body at three bytes a character', () => {
    expect(MAX_TOTAL_FIELD_LENGTH * 3).toBeLessThan(50 * 1024 * 1024);
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

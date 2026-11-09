import {
  parseStoredAiFileFailures,
  storableAiFileFailures,
} from './aiFileFailureReasons';

describe('parseStoredAiFileFailures', () => {
  const stored = [
    { name: 'week 3.pdf', reason: 'declined' },
    { name: 'notes.md', reason: 'no_text' },
  ];

  it('reads the parsed jsonb Postgres returns', () => {
    expect(parseStoredAiFileFailures(stored)).toEqual(stored);
  });

  it('reads the JSON text sqlite returns', () => {
    expect(parseStoredAiFileFailures(JSON.stringify(stored))).toEqual(stored);
  });

  it.each([
    ['no value', null],
    ['text that is not JSON', '{not json'],
    ['an object, not a list', { name: 'a.md', reason: 'declined' }],
  ])('reads %s as no files', (_case, value) => {
    expect(parseStoredAiFileFailures(value)).toEqual([]);
  });

  it('drops an entry with an unknown reason, no name or extra fields', () => {
    expect(
      parseStoredAiFileFailures([
        { name: 'a.md', reason: 'exploded' },
        { reason: 'declined' },
        { name: '', reason: 'declined' },
        { name: 'b.md', reason: 'too_large', extra: '<script>' },
      ])
    ).toEqual([{ name: 'b.md', reason: 'too_large' }]);
  });
});

describe('storableAiFileFailures', () => {
  it('strips characters Postgres jsonb or My decks cannot hold', () => {
    expect(
      storableAiFileFailures([
        { name: 'week\u00003\n.pdf', reason: 'declined' },
      ])
    ).toEqual([{ name: 'week3.pdf', reason: 'declined' }]);
  });

  it('cuts a long name to what the reader keeps, so the file still shows', () => {
    const [stored] = storableAiFileFailures([
      { name: `${'a'.repeat(300)}.md`, reason: 'no_text' },
    ]);

    expect(stored.name).toHaveLength(255);
    expect(parseStoredAiFileFailures(JSON.stringify([stored]))).toEqual([
      stored,
    ]);
  });

  it('never cuts an emoji in half at the length limit', () => {
    const [stored] = storableAiFileFailures([
      { name: `${'a'.repeat(254)}\u{1F600}`, reason: 'declined' },
    ]);

    expect(stored.name).toBe('a'.repeat(254));
    expect(JSON.stringify(stored)).not.toMatch(/\\ud8/i);
  });

  it('drops a name with nothing left after cleaning', () => {
    expect(
      storableAiFileFailures([{ name: '\u0000\u0001', reason: 'declined' }])
    ).toEqual([]);
  });
});

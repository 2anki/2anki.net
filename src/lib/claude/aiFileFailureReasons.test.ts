import { parseStoredAiFileFailures } from './aiFileFailureReasons';

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

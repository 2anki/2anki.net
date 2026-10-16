import {
  NotionDatabaseColumnsError,
  notionDatabaseColumnsReason,
} from './NotionDatabaseColumnsError';

describe('notionDatabaseColumnsReason', () => {
  it('names the single column and asks for a back column', () => {
    expect(notionDatabaseColumnsReason(['Name'])).toBe(
      'This database has only one column, Name. Cards need a front and a back column. Add a text column for the back, fill it in, then convert again.'
    );
  });

  it('asks for two columns when the database exposes none', () => {
    expect(notionDatabaseColumnsReason([])).toBe(
      'This database has no columns we can read. Cards need a front and a back column. Add two text columns, fill them in, then convert again.'
    );
  });

  it('names the requested columns that the database does not have', () => {
    expect(
      notionDatabaseColumnsReason(['Term', 'Definition'], {
        frontField: 'Nope',
        backField: 'Definition',
      })
    ).toBe(
      'This database has no column named Nope. It has: Term, Definition. Pick a column that exists for the front and the back, then convert again.'
    );
  });
});

describe('NotionDatabaseColumnsError', () => {
  it('carries the reason as its message and a name that survives the worker boundary', () => {
    const error = new NotionDatabaseColumnsError(['Name']);
    expect(error.name).toBe('NotionDatabaseColumnsError');
    expect(error.message).toBe(notionDatabaseColumnsReason(['Name']));
    expect(error.columns).toEqual(['Name']);
  });
});

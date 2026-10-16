import {
  NotionDatabaseColumnsError,
  notionDatabaseColumnsReason,
} from './NotionDatabaseColumnsError';

describe('notionDatabaseColumnsReason', () => {
  it('names the single column and asks for a back column', () => {
    expect(notionDatabaseColumnsReason(['Name'])).toBe(
      'This database has only one column, "Name". Cards need a front and a back column. Add a text column for the back, fill it in, then convert again.'
    );
  });

  it('asks for rows when the database has none, since columns are read from the first row', () => {
    expect(notionDatabaseColumnsReason([])).toBe(
      'This database has no rows yet. Add a row with a front and a back column filled in, then convert again.'
    );
  });

  it('keeps the one-column copy even when the request names columns it lacks', () => {
    expect(
      notionDatabaseColumnsReason(['Name'], {
        frontField: 'Nope',
        backField: 'Also Nope',
      })
    ).toMatch(/^This database has only one column, "Name"\./);
  });

  it('names one requested column the database does not have', () => {
    expect(
      notionDatabaseColumnsReason(['Term', 'Definition'], {
        frontField: 'Nope',
        backField: 'Definition',
      })
    ).toBe(
      'This database has no column named "Nope". It has "Term" and "Definition". Pick columns it has for the front and the back, then convert again.'
    );
  });

  it('names both requested columns with a conjunction and an Oxford comma on the list it has', () => {
    expect(
      notionDatabaseColumnsReason(['Term', 'Definition', 'Tags'], {
        frontField: 'Nope',
        backField: 'Also Nope',
      })
    ).toBe(
      'This database has no columns named "Nope" or "Also Nope". It has "Term", "Definition", and "Tags". Pick columns it has for the front and the back, then convert again.'
    );
  });

  it('lists the first five columns of a wide database and counts the rest', () => {
    const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    expect(
      notionDatabaseColumnsReason(columns, { frontField: 'Z', backField: 'A' })
    ).toBe(
      'This database has no column named "Z". It has "A", "B", "C", "D", "E", and 3 more. Pick columns it has for the front and the back, then convert again.'
    );
  });

  it('falls back to asking for a pick when two or more columns exist and none was requested', () => {
    expect(notionDatabaseColumnsReason(['Term', 'Definition'])).toBe(
      'Cards need a front and a back column. This database has "Term" and "Definition". Pick one for each, then convert again.'
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

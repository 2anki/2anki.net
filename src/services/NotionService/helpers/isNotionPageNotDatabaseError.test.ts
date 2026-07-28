import { isNotionPageNotDatabaseError } from './isNotionPageNotDatabaseError';

describe('isNotionPageNotDatabaseError', () => {
  it('returns true for a validation_error whose message says it is a page', () => {
    expect(
      isNotionPageNotDatabaseError({
        code: 'validation_error',
        message:
          'Provided database_id abc is a page, not a database. Use the pages API instead, or pass the ID of the database itself.',
      })
    ).toBe(true);
  });

  it('returns false for a different validation_error message', () => {
    expect(
      isNotionPageNotDatabaseError({
        code: 'validation_error',
        message: 'body failed validation',
      })
    ).toBe(false);
  });

  it('returns false for a non-validation Notion error code', () => {
    expect(
      isNotionPageNotDatabaseError({
        code: 'object_not_found',
        message: 'is a page, not a database',
      })
    ).toBe(false);
  });

  it('returns false for null, strings, and errors without a message', () => {
    expect(isNotionPageNotDatabaseError(null)).toBe(false);
    expect(isNotionPageNotDatabaseError('is a page, not a database')).toBe(
      false
    );
    expect(isNotionPageNotDatabaseError({ code: 'validation_error' })).toBe(
      false
    );
  });
});

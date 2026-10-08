import { EmptyDeckError } from './EmptyDeckError';

describe('EmptyDeckError', () => {
  it('is an Error subclass with the EmptyDeckError name', () => {
    const error = new EmptyDeckError();

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EmptyDeckError);
    expect(error.name).toBe('EmptyDeckError');
  });

  it('carries a non-empty message describing what went wrong and what to do', () => {
    const error = new EmptyDeckError();

    expect(error.message).toBe(
      'No cards found in your upload. Use .zip, .html, .md, or .csv.'
    );
  });

  it('has undefined sourceFormat when constructed without arguments', () => {
    expect(new EmptyDeckError().sourceFormat).toBeUndefined();
  });

  it('stores markdown sourceFormat when provided', () => {
    expect(new EmptyDeckError('markdown').sourceFormat).toBe('markdown');
  });

  it('defaults reason to unknown', () => {
    expect(new EmptyDeckError().reason).toBe('unknown');
  });

  it('stores the classified reason when provided', () => {
    expect(new EmptyDeckError(undefined, 'all_filtered').reason).toBe(
      'all_filtered'
    );
  });

  it('survives an instanceof check after being thrown and caught', () => {
    let caught: unknown;
    try {
      throw new EmptyDeckError();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EmptyDeckError);
  });
});

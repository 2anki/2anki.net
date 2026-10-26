import { getUploadValidationError } from './getUploadValidationError';
import { UploadedFile } from '../storage/types';

function makeFile(overrides: Partial<UploadedFile>): UploadedFile {
  return {
    originalname: 'export.html',
    mimetype: 'text/html',
    size: 1024,
    path: '/tmp/abc',
    fieldname: 'pakker',
    encoding: '7bit',
    destination: '/tmp',
    filename: 'abc',
    buffer: Buffer.alloc(0),
    stream: null as any,
    key: '',
    ...overrides,
  };
}

describe('getUploadValidationError', () => {
  test('returns error when no files are provided', () => {
    const error = getUploadValidationError([]);
    expect(error).not.toBeNull();
    expect(error!.message).toContain('select a file');
  });

  test('returns error when files is undefined', () => {
    const error = getUploadValidationError(undefined as any);
    expect(error).not.toBeNull();
    expect(error!.message).toContain('select a file');
  });

  test('returns error when file is zero bytes', () => {
    const error = getUploadValidationError([
      makeFile({ size: 0, originalname: 'ExportBlock-Part-1' }),
    ]);
    expect(error).not.toBeNull();
    expect(error!.message).toContain('empty');
  });

  test('returns error when an apkg file is uploaded', () => {
    const error = getUploadValidationError([
      makeFile({ originalname: '🧠 L4 Neurotransmission.apkg', size: 82138 }),
    ]);
    expect(error).not.toBeNull();
    expect(error!.message).toContain('already an Anki deck');
  });

  test.each([
    'Profile.colpkg',
    'collection.anki2',
    'collection.anki21',
    'collection.anki21b',
  ])('names %s as an Anki deck', (originalname) => {
    const error = getUploadValidationError([
      makeFile({ originalname, size: 51200 }),
    ]);
    expect(error!.message).toContain('already an Anki deck');
  });

  test('returns error when an uppercase .APKG file is uploaded', () => {
    const error = getUploadValidationError([
      makeFile({ originalname: 'Deck.UPPER.APKG', size: 82138 }),
    ]);
    expect(error).not.toBeNull();
    expect(error!.message).toContain('already an Anki deck');
  });

  test('returns null for a valid html file', () => {
    const error = getUploadValidationError([
      makeFile({ originalname: 'export.html', size: 5000 }),
    ]);
    expect(error).toBeNull();
  });

  test('returns null for a valid zip file', () => {
    const error = getUploadValidationError([
      makeFile({ originalname: 'notion-export.zip', size: 20000 }),
    ]);
    expect(error).toBeNull();
  });

  test('returns error when file has no originalname', () => {
    const error = getUploadValidationError([
      makeFile({ originalname: undefined as any, size: undefined as any }),
    ]);
    expect(error).not.toBeNull();
    expect(error!.message).toContain('invalid');
  });

  test('returns a Pages-specific error for an Apple Pages file', () => {
    const error = getUploadValidationError([
      makeFile({ originalname: 'Week 18 notes.pages', size: 183022 }),
    ]);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("We can't read Pages files");
    expect(error!.message).toContain('Week 18 notes.pages');
    expect(error!.message).toContain('.docx');
  });

  test('rejects an uppercase .PAGES file too', () => {
    const error = getUploadValidationError([
      makeFile({ originalname: 'NOTES.PAGES', size: 183022 }),
    ]);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("We can't read Pages files");
  });

  test('returns null for .docx file', () => {
    const error = getUploadValidationError([
      makeFile({ originalname: 'exam questions.docx', size: 30264 }),
    ]);
    expect(error).toBeNull();
  });

  test('does not throw if a file arrives with a non-string originalname', () => {
    const suspect = makeFile({ size: 1024 });
    (suspect as unknown as { originalname: unknown }).originalname = 42;
    expect(() => getUploadValidationError([suspect])).not.toThrow();
  });

  test('accepts an apkg file when allowApkg is true', () => {
    const error = getUploadValidationError(
      [makeFile({ originalname: 'Pharmacology.apkg', size: 82138 })],
      { allowApkg: true }
    );
    expect(error).toBeNull();
  });

  test('still rejects an empty apkg file when allowApkg is true', () => {
    const error = getUploadValidationError(
      [makeFile({ originalname: 'Pharmacology.apkg', size: 0 })],
      { allowApkg: true }
    );
    expect(error).not.toBeNull();
    expect(error!.message).toContain('empty');
  });
});

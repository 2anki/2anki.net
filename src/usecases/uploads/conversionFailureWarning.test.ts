import {
  buildConversionFailureWarning,
  buildTooLongWordFileWarning,
} from './conversionFailureWarning';

describe('buildConversionFailureWarning', () => {
  it('returns null when no files failed', () => {
    expect(buildConversionFailureWarning([])).toBeNull();
  });

  it('names the single failed file and points at the fix', () => {
    expect(buildConversionFailureWarning(['essay.docx'])).toBe(
      'essay.docx could not be converted and was skipped. The rest of your upload converted — try uploading that file on its own.'
    );
  });

  it('lists every failed file when several fail', () => {
    expect(buildConversionFailureWarning(['essay.docx', 'broken.doc'])).toBe(
      '2 files could not be converted and were skipped: essay.docx, broken.doc. The rest of your upload converted — try uploading them on their own.'
    );
  });

  it('strips directory prefixes and drops empty names', () => {
    expect(buildConversionFailureWarning(['folder/notes.docx', ''])).toBe(
      'notes.docx could not be converted and was skipped. The rest of your upload converted — try uploading that file on its own.'
    );
  });
});

describe('buildTooLongWordFileWarning', () => {
  it('returns null when no Word file was too long', () => {
    expect(buildTooLongWordFileWarning([])).toBeNull();
  });

  it('names the file and tells the person to split it', () => {
    expect(buildTooLongWordFileWarning(['folder/Thesis.docx'])).toBe(
      'Thesis.docx is too long to convert in one go and was skipped. Split it into smaller files and convert each one separately.'
    );
  });

  it('names every file when several were too long', () => {
    expect(buildTooLongWordFileWarning(['a.docx', 'b.docx'])).toBe(
      '2 Word files are too long to convert in one go and were skipped: a.docx, b.docx. Split them into smaller files and convert each one separately.'
    );
  });
});

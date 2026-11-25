import { buildConversionFailureWarning } from './conversionFailureWarning';

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

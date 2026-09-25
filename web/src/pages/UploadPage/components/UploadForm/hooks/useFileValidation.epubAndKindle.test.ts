import { describe, expect, it } from 'vitest';

import { detectUploadIssues } from './useFileValidation';

function makeFile(name: string): File {
  return new File([''], name, { type: 'application/octet-stream' });
}

describe('detectUploadIssues — reading formats', () => {
  it('returns info hint for a Kindle My Clippings.txt upload', () => {
    const result = detectUploadIssues([makeFile('My Clippings.txt')]);
    expect(result).not.toBeNull();
    expect(result?.status).toBe('info');
    expect(result?.title).toBe('upload.validation.readingFormat.title');
    expect(result?.body).toBe('upload.validation.readingFormat.body');
    expect(result?.continueLabel).toBe(
      'upload.validation.readingFormat.continue'
    );
  });

  it('returns info hint for a .epub upload', () => {
    const result = detectUploadIssues([makeFile('Discourse.epub')]);
    expect(result?.status).toBe('info');
    expect(result?.body).toBe('upload.validation.readingFormat.body');
  });

  it('matches My Clippings.txt case-insensitively', () => {
    const result = detectUploadIssues([makeFile('MY CLIPPINGS.TXT')]);
    expect(result?.status).toBe('info');
  });

  it('does not match a generic .txt file', () => {
    const result = detectUploadIssues([makeFile('notes.txt')]);
    expect(result).toBeNull();
  });

  it('does not fire for non-reading formats', () => {
    const result = detectUploadIssues([makeFile('export.zip')]);
    expect(result).toBeNull();
  });
});

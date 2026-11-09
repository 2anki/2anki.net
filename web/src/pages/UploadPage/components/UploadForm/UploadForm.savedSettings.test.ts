import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Every request the form builds (file upload, Dropbox, Drive, Claude resends,
// rescues, the gate's parser deck, the password retry) appends the browser's
// settings through appendSavedCardSettings, never the whole of localStorage.
describe('UploadForm request bodies', () => {
  const source = readFileSync(path.join(__dirname, 'UploadForm.tsx'), 'utf8');

  it('never appends the whole of localStorage', () => {
    expect(source).not.toMatch(
      /Object\.entries\(\s*(globalThis\.)?localStorage\s*\)/
    );
  });

  it('sends the saved settings from every request it builds', () => {
    expect(source.match(/appendSavedCardSettings\(formData\)/g)).toHaveLength(
      11
    );
  });
});

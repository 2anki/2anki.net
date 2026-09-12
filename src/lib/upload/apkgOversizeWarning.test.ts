import {
  apkgOversizeWarning,
  apkgOversizeWarningText,
} from './apkgOversizeWarning';

describe('apkgOversizeWarning', () => {
  it('is silent at and under the AnkiWeb limit', () => {
    expect(apkgOversizeWarning(100 * 1024 * 1024)).toBeNull();
    expect(apkgOversizeWarning(12_345)).toBeNull();
  });

  it('codes the rounded size in megabytes above the limit', () => {
    expect(apkgOversizeWarning(105 * 1024 * 1024)).toBe('apkg-over-100mb:105');
    expect(apkgOversizeWarning(100 * 1024 * 1024 + 1)).toBe(
      'apkg-over-100mb:100'
    );
  });

  it('renders the user sentence with the size and the one action', () => {
    expect(apkgOversizeWarningText(210)).toBe(
      "This deck is 210 MB. AnkiWeb won't sync packages over 100 MB, so split it into smaller decks before syncing."
    );
  });
});

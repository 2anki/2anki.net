import { isAnkiPackageZip, isZipOfAnkiDecks } from './isAnkiPackageZip';

describe('isAnkiPackageZip', () => {
  it.each([
    ['collection.anki2'],
    ['collection.anki21'],
    ['collection.anki21b'],
  ])('detects a package carrying %s', (collection) => {
    const names = [collection, 'media', '0', '1', '2'];
    expect(isAnkiPackageZip(names)).toBe(true);
  });

  it('ignores a Notion export that happens to contain extensionless files', () => {
    expect(isAnkiPackageZip(['Page abc.html', 'Page abc/README', '0'])).toBe(
      false
    );
  });

  it('detects a package wrapped in a folder', () => {
    expect(isAnkiPackageZip(['deck/collection.anki2', 'deck/media'])).toBe(
      true
    );
  });
});

describe('isZipOfAnkiDecks', () => {
  it('detects a zip that holds only decks', () => {
    expect(
      isZipOfAnkiDecks([
        'Biology.apkg',
        'Chemistry.apkg',
        'backup/Profile.colpkg',
        '__MACOSX/._Biology.apkg',
        '.DS_Store',
      ])
    ).toBe(true);
  });

  it('leaves a zip with notes beside a deck to the converter', () => {
    expect(isZipOfAnkiDecks(['Biology.apkg', 'notes.md'])).toBe(false);
  });

  it('is false for a zip with no files', () => {
    expect(isZipOfAnkiDecks(['folder/', '.DS_Store'])).toBe(false);
  });
});

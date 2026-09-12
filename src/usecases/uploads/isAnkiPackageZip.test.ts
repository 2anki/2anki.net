import { isAnkiPackageZip } from './isAnkiPackageZip';

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

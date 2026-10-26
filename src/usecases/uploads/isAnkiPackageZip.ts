const ANKI_COLLECTION_FILES = new Set([
  'collection.anki2',
  'collection.anki21',
  'collection.anki21b',
]);

// An .apkg is a zip whose media entries are named by index ("0", "1", …)
// beside a collection database. Renamed or re-wrapped as .zip it slips past
// the .apkg extension check, and every numbered entry then looks like a
// supported extensionless content file — 898 candidates each carrying the
// other 897 as "relevant" files (#4409).
export function isAnkiPackageZip(fileNames: readonly string[]): boolean {
  return fileNames.some((name) =>
    ANKI_COLLECTION_FILES.has(name.slice(name.lastIndexOf('/') + 1))
  );
}

const DECK_FILE = /\.(apkg|colpkg)$/i;

function isPackingNoise(name: string): boolean {
  const base = name.slice(name.lastIndexOf('/') + 1);
  return (
    name.endsWith('/') ||
    name.startsWith('__MACOSX/') ||
    base.startsWith('.') ||
    base === 'Thumbs.db' ||
    base === 'desktop.ini'
  );
}

// The bulk download hands back several decks in one zip, and people drop that
// zip on the upload page again: every file in it is a deck, so it is a deck
// upload, not a source to convert. A zip that also holds notes still converts.
export function isZipOfAnkiDecks(fileNames: readonly string[]): boolean {
  const files = fileNames.filter((name) => !isPackingNoise(name));
  return files.length > 0 && files.every((name) => DECK_FILE.test(name));
}

export const ANKI_PACKAGE_ZIP_MESSAGE =
  "This zip contains an Anki package, so it's already an Anki deck. 2anki converts source files like Notion HTML exports, not existing decks.";

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

export const ANKI_PACKAGE_ZIP_MESSAGE =
  "This zip contains an Anki package, so it's already an Anki deck. 2anki converts source files like Notion HTML exports, not existing decks.";

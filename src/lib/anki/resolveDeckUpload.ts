import path from 'path';
import { unzipSync } from 'fflate';

import { isAnkiPackageZip } from '../../usecases/uploads/isAnkiPackageZip';
import { isHiddenFileOrDirectory } from '../storage/checks';
import { isSafeZipEntryName } from '../zip/isSafeZipEntryName';

export type DeckUpload =
  | { kind: 'deck'; deck: Buffer; deckName: string; shape: DeckUploadShape }
  | { kind: 'choose'; decks: string[] }
  | { kind: 'not_a_deck' };

export type DeckUploadShape =
  | 'apkg'
  | 'zip_is_deck'
  | 'zip_one_deck'
  | 'zip_chosen_deck';

// Only a file we cannot read at all ends here; every other upload has a next
// step (open the deck, pick one, or make a deck from it).
export class DeckUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeckUploadError';
  }
}

const MAX_INNER_DECK_BYTES = 100 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;
// fflate trusts the zip's own entry count, so a tiny crafted zip can claim
// billions of entries; real decks and exports hold far fewer.
const MAX_ZIP_ENTRIES = 10_000;

export const UNREADABLE_ZIP_MESSAGE =
  'This zip couldn’t be opened. It may still be downloading; wait for it to finish and try again.';
export const INNER_DECK_TOO_LARGE_MESSAGE =
  'The deck inside this zip is over 100 MB. Open it in Anki and export a smaller deck.';

function stripExtension(name: string): string {
  return path.posix.basename(name).replace(/(\.(apkg|zip))+$/i, '');
}

function isInnerDeck(name: string): boolean {
  const base = path.posix.basename(name);
  return (
    /\.apkg$/i.test(base) &&
    !base.startsWith('._') &&
    !isHiddenFileOrDirectory(name) &&
    isSafeZipEntryName(name)
  );
}

function listEntryNames(zip: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(zip, {
    filter: (file) => {
      if (names.length >= MAX_ZIP_ENTRIES) {
        throw new DeckUploadError(UNREADABLE_ZIP_MESSAGE);
      }
      names.push(file.name);
      return false;
    },
  });
  return names;
}

function extractEntry(zip: Uint8Array, entryName: string): Buffer {
  let tooLarge = false;
  let taken = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, {
      filter: (file) => {
        // A directory can list one name many times over the same data;
        // inflate it once.
        if (taken || file.name !== entryName) return false;
        // The header's sizes are claims: a compressed size larger than the
        // whole upload is a lie meant to pass the ratio check, and fflate
        // allocates the claimed uncompressed size up front.
        if (file.size > zip.length) {
          tooLarge = true;
          return false;
        }
        if (
          file.originalSize > MAX_INNER_DECK_BYTES ||
          file.originalSize > file.size * MAX_COMPRESSION_RATIO + 1024
        ) {
          tooLarge = true;
          return false;
        }
        taken = true;
        return true;
      },
    });
  } catch {
    throw new DeckUploadError(UNREADABLE_ZIP_MESSAGE);
  }
  if (tooLarge) throw new DeckUploadError(INNER_DECK_TOO_LARGE_MESSAGE);
  const contents = files[entryName];
  if (contents == null) throw new DeckUploadError(UNREADABLE_ZIP_MESSAGE);
  // A short stream inside a larger claimed size leaves the bytes as a small
  // view of a big buffer; copy it so the rest can be freed.
  return contents.byteLength === contents.buffer.byteLength
    ? Buffer.from(contents.buffer, contents.byteOffset, contents.byteLength)
    : Buffer.from(contents);
}

function readZip(upload: Buffer): { zip: Uint8Array; names: string[] } {
  const zip = new Uint8Array(
    upload.buffer,
    upload.byteOffset,
    upload.byteLength
  );
  try {
    return { zip, names: listEntryNames(zip) };
  } catch {
    throw new DeckUploadError(UNREADABLE_ZIP_MESSAGE);
  }
}

// Decks reach us as .apkg, as an .apkg the browser or OS saved with a .zip
// name, or zipped up with other files. All of them are the same deck to the
// person printing it, so all of them open. `chosenEntry` is the deck the
// person picked when the zip held several.
export function resolveDeckUpload(
  upload: Buffer,
  filename: string,
  chosenEntry?: string | null
): DeckUpload {
  if (/\.apkg$/i.test(filename)) {
    return {
      kind: 'deck',
      deck: upload,
      deckName: stripExtension(filename),
      shape: 'apkg',
    };
  }
  if (!/\.zip$/i.test(filename)) return { kind: 'not_a_deck' };

  const { zip, names } = readZip(upload);
  if (isAnkiPackageZip(names)) {
    return {
      kind: 'deck',
      deck: upload,
      deckName: stripExtension(filename),
      shape: 'zip_is_deck',
    };
  }

  const decks = [...new Set(names.filter(isInnerDeck))];
  if (decks.length === 0) return { kind: 'not_a_deck' };

  if (chosenEntry != null && decks.includes(chosenEntry)) {
    return {
      kind: 'deck',
      deck: extractEntry(zip, chosenEntry),
      deckName: stripExtension(chosenEntry),
      shape: 'zip_chosen_deck',
    };
  }
  if (decks.length > 1) return { kind: 'choose', decks };

  return {
    kind: 'deck',
    deck: extractEntry(zip, decks[0]),
    deckName: stripExtension(decks[0]),
    shape: 'zip_one_deck',
  };
}

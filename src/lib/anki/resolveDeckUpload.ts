import path from 'path';
import yauzl from 'yauzl';

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
// A zip states its own entry count; real decks and exports hold far fewer.
const MAX_ZIP_ENTRIES = 10_000;
// The deck list goes back to the browser to pick from, so it stays small no
// matter how many or how long the names in a crafted zip are.
const MAX_DECK_NAME_LENGTH = 512;
const MAX_DECK_CHOICES = 50;

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
    name.length <= MAX_DECK_NAME_LENGTH &&
    /\.apkg$/i.test(base) &&
    !base.startsWith('._') &&
    !isHiddenFileOrDirectory(name) &&
    isSafeZipEntryName(name)
  );
}

function openZip(upload: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(upload, { lazyEntries: true }, (error, zipfile) => {
      if (error || !zipfile) {
        reject(new DeckUploadError(UNREADABLE_ZIP_MESSAGE));
        return;
      }
      resolve(zipfile);
    });
  });
}

// Only the central directory is read here; no entry is inflated.
function listEntries(
  zipfile: yauzl.ZipFile
): Promise<Map<string, yauzl.Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, yauzl.Entry>();
    let seen = 0;
    zipfile.on('entry', (entry: yauzl.Entry) => {
      seen += 1;
      if (seen > MAX_ZIP_ENTRIES) {
        zipfile.close();
        reject(new DeckUploadError(UNREADABLE_ZIP_MESSAGE));
        return;
      }
      // A directory can list one name many times; the first one counts.
      if (!entries.has(entry.fileName)) entries.set(entry.fileName, entry);
      zipfile.readEntry();
    });
    zipfile.on('end', () => resolve(entries));
    zipfile.on('error', () =>
      reject(new DeckUploadError(UNREADABLE_ZIP_MESSAGE))
    );
    zipfile.readEntry();
  });
}

// Inflation runs in zlib off the event loop and stops at the size the entry
// declares (yauzl checks the real size against it), so a header that lies
// about its sizes cannot buy more memory or CPU than the cap.
function readDeck(
  zipfile: yauzl.ZipFile,
  entry: yauzl.Entry,
  uploadBytes: number
): Promise<Buffer> {
  if (
    entry.compressedSize > uploadBytes ||
    entry.uncompressedSize > MAX_INNER_DECK_BYTES ||
    entry.uncompressedSize > entry.compressedSize * MAX_COMPRESSION_RATIO + 1024
  ) {
    return Promise.reject(new DeckUploadError(INNER_DECK_TOO_LARGE_MESSAGE));
  }
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new DeckUploadError(UNREADABLE_ZIP_MESSAGE));
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      stream.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > entry.uncompressedSize) {
          stream.destroy();
          reject(new DeckUploadError(UNREADABLE_ZIP_MESSAGE));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', () =>
        reject(new DeckUploadError(UNREADABLE_ZIP_MESSAGE))
      );
    });
  });
}

// Decks reach us as .apkg, as an .apkg the browser or OS saved with a .zip
// name, or zipped up with other files. All of them are the same deck to the
// person printing it, so all of them open. `chosenEntry` is the deck the
// person picked when the zip held several.
export async function resolveDeckUpload(
  upload: Buffer,
  filename: string,
  chosenEntry?: string | null
): Promise<DeckUpload> {
  if (/\.apkg$/i.test(filename)) {
    return {
      kind: 'deck',
      deck: upload,
      deckName: stripExtension(filename),
      shape: 'apkg',
    };
  }
  if (!/\.zip$/i.test(filename)) return { kind: 'not_a_deck' };

  const zipfile = await openZip(upload);
  try {
    const entries = await listEntries(zipfile);
    const names = [...entries.keys()];
    if (isAnkiPackageZip(names)) {
      return {
        kind: 'deck',
        deck: upload,
        deckName: stripExtension(filename),
        shape: 'zip_is_deck',
      };
    }

    const decks = names.filter(isInnerDeck);
    if (decks.length === 0) return { kind: 'not_a_deck' };

    const picked =
      chosenEntry != null && decks.includes(chosenEntry) ? chosenEntry : null;
    if (picked == null && decks.length > 1) {
      return { kind: 'choose', decks: decks.slice(0, MAX_DECK_CHOICES) };
    }

    const name = picked ?? decks[0];
    const entry = entries.get(name) as yauzl.Entry;
    return {
      kind: 'deck',
      deck: await readDeck(zipfile, entry, upload.length),
      deckName: stripExtension(name),
      shape: picked == null ? 'zip_one_deck' : 'zip_chosen_deck',
    };
  } finally {
    zipfile.close();
  }
}

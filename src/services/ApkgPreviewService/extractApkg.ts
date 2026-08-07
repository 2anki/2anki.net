import { Decompress, decompress as zstdDecompress } from 'fzstd';
import yauzl from 'yauzl';

import { readRepeatedSubmessages, readString } from './protobuf';

export interface ApkgArchive {
  collectionBuffer: Buffer;
  collectionName: string;
  mediaManifestRaw: Buffer | null;
  mediaEntries: Map<string, Buffer>;
}

// This runs in the main Express process (single pm2 instance), so a zip bomb
// here takes down every in-flight conversion, not one worker. Caps sized for
// the 100MB multer limit on the apkg routes: honest media is stored ~1:1 and
// a large collection sqlite decompresses well under these.
const MAX_TOTAL_DECOMPRESSED_BYTES = 1024 * 1024 * 1024;
const MAX_COLLECTION_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 65536;

export interface ExtractApkgLimits {
  maxTotalDecompressedBytes?: number;
  maxCollectionDecompressedBytes?: number;
  maxEntries?: number;
}

export class ApkgTooLargeError extends Error {
  constructor() {
    super('This Anki package is too large to process.');
    this.name = 'ApkgTooLargeError';
  }
}

const COLLECTION_CANDIDATES = [
  'collection.anki21b',
  'collection.anki21',
  'collection.anki2',
];

function readEntry(
  zipfile: yauzl.ZipFile,
  entry: yauzl.Entry,
  remainingBudget: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error('no stream'));
      const chunks: Buffer[] = [];
      let received = 0;
      stream.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > remainingBudget) {
          stream.destroy();
          reject(new ApkgTooLargeError());
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

function decompressCollectionCapped(
  compressed: Buffer,
  maxBytes: number
): Buffer {
  const chunks: Uint8Array[] = [];
  let produced = 0;
  let overflow = false;
  const stream = new Decompress((chunk) => {
    produced += chunk.length;
    if (produced > maxBytes) {
      overflow = true;
      return;
    }
    chunks.push(chunk);
  });
  stream.push(new Uint8Array(compressed), true);
  if (overflow) {
    throw new ApkgTooLargeError();
  }
  return Buffer.concat(chunks);
}

export async function extractApkg(
  bytes: Buffer,
  limits: ExtractApkgLimits = {}
): Promise<ApkgArchive> {
  const maxTotal =
    limits.maxTotalDecompressedBytes ?? MAX_TOTAL_DECOMPRESSED_BYTES;
  const maxCollection =
    limits.maxCollectionDecompressedBytes ?? MAX_COLLECTION_DECOMPRESSED_BYTES;
  const maxEntries = limits.maxEntries ?? MAX_ENTRIES;

  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('open failed'));

      const collections: Map<string, Buffer> = new Map();
      const mediaEntries: Map<string, Buffer> = new Map();
      let mediaManifestRaw: Buffer | null = null;
      let declaredTotal = 0;
      let inflatedTotal = 0;
      let entryCount = 0;
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (settled) return;
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        entryCount += 1;
        if (entryCount > maxEntries) {
          fail(new ApkgTooLargeError());
          return;
        }
        // Central-directory declared size: refuse before inflating a single
        // byte of an entry that would push the archive past the cap. The
        // running count during inflation below catches lying headers.
        declaredTotal += entry.uncompressedSize;
        if (declaredTotal > maxTotal) {
          fail(new ApkgTooLargeError());
          return;
        }
        readEntry(zipfile, entry, maxTotal - inflatedTotal)
          .then((buf) => {
            if (settled) return;
            inflatedTotal += buf.length;
            if (COLLECTION_CANDIDATES.includes(entry.fileName)) {
              collections.set(entry.fileName, buf);
            } else if (entry.fileName === 'media') {
              mediaManifestRaw = buf;
            } else if (/^\d+$/.test(entry.fileName)) {
              mediaEntries.set(entry.fileName, buf);
            }
            zipfile.readEntry();
          })
          .catch(fail);
      });

      zipfile.on('end', () => {
        if (settled) return;
        const name = COLLECTION_CANDIDATES.find((candidate) =>
          collections.has(candidate)
        );
        if (!name) {
          fail(new Error('No Anki collection file found in archive'));
          return;
        }
        let collectionBuffer = collections.get(name) as Buffer;
        if (name === 'collection.anki21b') {
          try {
            collectionBuffer = decompressCollectionCapped(
              collectionBuffer,
              maxCollection
            );
          } catch (decompressError) {
            fail(decompressError as Error);
            return;
          }
        }
        settled = true;
        resolve({
          collectionBuffer,
          collectionName: name,
          mediaManifestRaw,
          mediaEntries,
        });
      });

      zipfile.on('error', fail);
      zipfile.readEntry();
    });
  });
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function isZstdCompressed(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).equals(ZSTD_MAGIC);
}

function parseProtobufMediaManifest(buf: Buffer): Map<string, string> {
  const map = new Map<string, string>();
  const entries = readRepeatedSubmessages(buf, 1);
  for (let i = 0; i < entries.length; i++) {
    const name = readString(entries[i], 1);
    if (name) {
      map.set(name, String(i));
    }
  }
  return map;
}

export function parseMediaManifest(raw: Buffer | null): Map<string, string> {
  if (!raw || raw.length === 0) return new Map();
  let buf = raw;
  if (isZstdCompressed(buf)) {
    buf = Buffer.from(zstdDecompress(new Uint8Array(buf)));
  }
  try {
    const json = JSON.parse(buf.toString('utf8')) as Record<string, string>;
    const map = new Map<string, string>();
    for (const [archiveName, originalName] of Object.entries(json)) {
      map.set(originalName, archiveName);
    }
    return map;
  } catch {
    return parseProtobufMediaManifest(buf);
  }
}

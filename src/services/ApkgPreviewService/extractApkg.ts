import { Decompress } from 'fzstd';
import yauzl from 'yauzl';

import { readRepeatedSubmessages, readString } from './protobuf';

export interface ApkgArchive {
  collectionBuffer: Buffer;
  collectionName: string;
  mediaManifestRaw: Buffer | null;
  mediaEntries: Map<string, Buffer>;
  passthroughEntries: Map<string, Buffer>;
}

// Runs in the main process; the caps bound what one archive can use. Honest
// media is stored about 1:1 and a large collection decompresses well under
// them.
export const MAX_TOTAL_DECOMPRESSED_BYTES = 1024 * 1024 * 1024;
const MAX_COLLECTION_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 65536;

// The media list names at most MAX_ENTRIES files, well under this even with
// the longest file names.
export const MAX_MEDIA_MANIFEST_DECOMPRESSED_BYTES = 64 * 1024 * 1024;

// Compressed input is fed to the decompressor this much at a time, so it stops
// soon after its output passes a cap instead of running to the end.
const ZSTD_INPUT_SLICE_BYTES = 512;

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

// The upload is not something Anki exported: not a zip at all, a zip yauzl
// cannot open, or a zip with no collection file. Callers answer 400 on this
// class instead of matching yauzl's message text.
export class InvalidApkgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidApkgError';
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

function decompressZstdCapped(compressed: Buffer, maxBytes: number): Buffer {
  const chunks: Uint8Array[] = [];
  let produced = 0;
  const stream = new Decompress((chunk) => {
    produced += chunk.length;
    if (produced <= maxBytes) chunks.push(chunk);
  });
  for (
    let offset = 0;
    offset < compressed.length && produced <= maxBytes;
    offset += ZSTD_INPUT_SLICE_BYTES
  ) {
    const end = Math.min(offset + ZSTD_INPUT_SLICE_BYTES, compressed.length);
    stream.push(compressed.subarray(offset, end), end === compressed.length);
  }
  if (produced > maxBytes) {
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
      if (err || !zipfile) {
        return reject(new InvalidApkgError(err?.message ?? 'open failed'));
      }

      const collections: Map<string, Buffer> = new Map();
      const mediaEntries: Map<string, Buffer> = new Map();
      let mediaManifestRaw: Buffer | null = null;
      let packageMetaRaw: Buffer | null = null;
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
            } else if (entry.fileName === 'meta') {
              packageMetaRaw = buf;
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
          fail(
            new InvalidApkgError('No Anki collection file found in archive')
          );
          return;
        }
        let collectionBuffer = collections.get(name) as Buffer;
        if (name === 'collection.anki21b') {
          try {
            collectionBuffer = decompressZstdCapped(
              collectionBuffer,
              maxCollection
            );
          } catch (decompressError) {
            fail(decompressError as Error);
            return;
          }
        }
        const passthroughEntries = new Map<string, Buffer>();
        if (packageMetaRaw) passthroughEntries.set('meta', packageMetaRaw);
        for (const [candidate, stored] of collections) {
          if (candidate !== name) passthroughEntries.set(candidate, stored);
        }
        settled = true;
        resolve({
          collectionBuffer,
          collectionName: name,
          mediaManifestRaw,
          mediaEntries,
          passthroughEntries,
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
    buf = decompressZstdCapped(buf, MAX_MEDIA_MANIFEST_DECOMPRESSED_BYTES);
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

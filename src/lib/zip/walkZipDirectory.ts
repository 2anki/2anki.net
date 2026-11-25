import { unzipSync } from 'fflate';

// A zip's end record says where its directory starts and how many entries it
// holds, and fflate walks that many from there without checking that each is
// a directory entry. Two cheap bounds keep a small or junk file from holding
// a process: the directory the end record names must lie inside the file and
// start with a directory entry's signature, and the walk stops at what the
// file could physically hold (no directory entry is smaller than 46 bytes) or
// a fixed ceiling. Past either, the directory counts as unreadable.
const SMALLEST_DIRECTORY_ENTRY_BYTES = 46;
export const MAX_ZIP_DIRECTORY_ENTRIES = 200_000;

const END_RECORD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_END_RECORD = 0x06064b50;
const DIRECTORY_ENTRY = 0x02014b50;
const END_RECORD_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;

export interface ZipDirectoryEntry {
  name: string;
  compressedSize: number;
  originalSize: number;
}

export type ZipDirectoryWalk = 'complete' | 'stopped' | 'unreadable';

interface DirectoryLocation {
  count: number;
  offset: number;
  size: number;
  zip64: boolean;
}

class StopWalking extends Error {}

function view(contents: Uint8Array): Buffer {
  return Buffer.from(contents.buffer, contents.byteOffset, contents.byteLength);
}

function readUInt32(bytes: Buffer, at: number): number | null {
  return at >= 0 && at + 4 <= bytes.length ? bytes.readUInt32LE(at) : null;
}

// Where the end record says the directory is, read the way fflate reads it.
function directoryLocation(bytes: Buffer): DirectoryLocation | null {
  const earliest = Math.max(
    0,
    bytes.length - END_RECORD_BYTES - MAX_COMMENT_BYTES
  );
  for (let end = bytes.length - END_RECORD_BYTES; end >= earliest; end--) {
    if (bytes.readUInt32LE(end) !== END_RECORD) continue;
    const location: DirectoryLocation = {
      count: bytes.readUInt16LE(end + 8),
      size: bytes.readUInt32LE(end + 12),
      offset: bytes.readUInt32LE(end + 16),
      zip64: false,
    };
    if (readUInt32(bytes, end - 20) !== ZIP64_LOCATOR) return location;
    const zip64End = readUInt32(bytes, end - 12);
    if (zip64End == null || readUInt32(bytes, zip64End) !== ZIP64_END_RECORD) {
      return location;
    }
    return {
      count: readUInt32(bytes, zip64End + 32) ?? 0,
      size: readUInt32(bytes, zip64End + 40) ?? 0,
      offset: readUInt32(bytes, zip64End + 48) ?? 0,
      zip64: true,
    };
  }
  return null;
}

function directoryIsInFile(bytes: Buffer, location: DirectoryLocation) {
  return (
    location.offset + location.size <= bytes.length &&
    readUInt32(bytes, location.offset) === DIRECTORY_ENTRY
  );
}

// Reads the directory without inflating any entry. `visit` returns 'stop'
// once it has what it needs.
export function walkZipDirectory(
  contents: Uint8Array,
  visit: (entry: ZipDirectoryEntry) => 'stop' | 'continue'
): ZipDirectoryWalk {
  const bytes = view(contents);
  const location = directoryLocation(bytes);
  if (location == null) return 'unreadable';
  if (location.count > 0 && !directoryIsInFile(bytes, location)) {
    return 'unreadable';
  }
  const limit = Math.min(
    Math.floor(bytes.length / SMALLEST_DIRECTORY_ENTRY_BYTES),
    MAX_ZIP_DIRECTORY_ENTRIES
  );
  let seen = 0;
  let stopped = false;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        seen += 1;
        if (seen > limit) throw new StopWalking();
        const next = visit({
          name: file.name,
          compressedSize: file.size,
          originalSize: file.originalSize,
        });
        if (next === 'stop') {
          stopped = true;
          throw new StopWalking();
        }
        return false;
      },
    });
  } catch {
    return stopped ? 'stopped' : 'unreadable';
  }
  return 'complete';
}

// The directory entry JSZip, the converter's zip reader, would use for
// `name`: of several with that name, the last. Every entry is checked for its
// signature and for fitting inside the directory, so the work never exceeds
// the directory's real length. A zip64 directory, or anything that does not
// read cleanly, is 'unreadable'.
export function lastZipEntryNamed(
  contents: Uint8Array,
  name: string
): ZipDirectoryEntry | null | 'unreadable' {
  const bytes = view(contents);
  const location = directoryLocation(bytes);
  if (location == null || location.zip64) return 'unreadable';
  if (location.count === 0) return null;
  if (!directoryIsInFile(bytes, location)) return 'unreadable';
  const wanted = Buffer.from(name);
  const directoryEnd = location.offset + location.size;
  let found: ZipDirectoryEntry | null = null;
  let at = location.offset;
  for (let index = 0; index < location.count; index++) {
    if (at + SMALLEST_DIRECTORY_ENTRY_BYTES > directoryEnd) return 'unreadable';
    if (bytes.readUInt32LE(at) !== DIRECTORY_ENTRY) return 'unreadable';
    const nameLength = bytes.readUInt16LE(at + 28);
    const next =
      at +
      SMALLEST_DIRECTORY_ENTRY_BYTES +
      nameLength +
      bytes.readUInt16LE(at + 30) +
      bytes.readUInt16LE(at + 32);
    if (next > directoryEnd) return 'unreadable';
    const nameStart = at + SMALLEST_DIRECTORY_ENTRY_BYTES;
    if (wanted.equals(bytes.subarray(nameStart, nameStart + nameLength))) {
      found = {
        name,
        compressedSize: bytes.readUInt32LE(at + 20),
        originalSize: bytes.readUInt32LE(at + 24),
      };
    }
    at = next;
  }
  return found;
}

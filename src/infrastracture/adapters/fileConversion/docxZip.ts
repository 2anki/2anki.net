import zlib from 'zlib';

// The zip directory of a .docx read without inflating anything, so a long
// Word file can be sized and declined before any work, and each piece of a
// split body can reuse the other entries' compressed bytes as they are.
export class UnsupportedZip extends Error {}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const DATA_DESCRIPTOR = 0x08074b50;
const END_OF_DIRECTORY_BYTES = 22;
const MAX_ZIP_COMMENT = 0xffff;
const ENCRYPTED = 0x1;
const HAS_DATA_DESCRIPTOR = 0x8;
const STORED = 0;
const DEFLATED = 8;

export interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  size: number;
  directoryStart: number;
  directoryEnd: number;
  recordStart: number;
  recordEnd: number;
  dataStart: number;
}

export interface ZipDirectory {
  entries: Map<string, ZipEntry>;
  order: ZipEntry[];
}

function endOfDirectory(zip: Buffer): number {
  const earliest = Math.max(
    0,
    zip.length - END_OF_DIRECTORY_BYTES - MAX_ZIP_COMMENT
  );
  for (let at = zip.length - END_OF_DIRECTORY_BYTES; at >= earliest; at--) {
    if (zip.readUInt32LE(at) === END_OF_DIRECTORY) return at;
  }
  throw new UnsupportedZip();
}

function isAsciiName(bytes: Buffer): boolean {
  for (const byte of bytes) if (byte < 0x20 || byte > 0x7e) return false;
  return true;
}

function recordEnd(zip: Buffer, entry: ZipEntry, limit: number): number {
  const dataEnd = entry.dataStart + entry.compressedSize;
  if ((entry.flags & HAS_DATA_DESCRIPTOR) === 0) return dataEnd;
  if (dataEnd + 4 <= limit && zip.readUInt32LE(dataEnd) === DATA_DESCRIPTOR) {
    return dataEnd + 16;
  }
  return dataEnd + 12;
}

// Declines what it does not fully read: zip64, encryption, more than one
// disk, a name outside printable ASCII, a duplicate name, or a record that
// overlaps the directory.
export function readZipDirectory(zip: Buffer): ZipDirectory {
  if (zip.length < END_OF_DIRECTORY_BYTES) throw new UnsupportedZip();
  const end = endOfDirectory(zip);
  const count = zip.readUInt16LE(end + 10);
  const directorySize = zip.readUInt32LE(end + 12);
  const directoryOffset = zip.readUInt32LE(end + 16);
  const commentLength = zip.readUInt16LE(end + 20);
  if (
    zip.readUInt16LE(end + 4) !== 0 ||
    zip.readUInt16LE(end + 6) !== 0 ||
    zip.readUInt16LE(end + 8) !== count ||
    count === 0xffff ||
    directoryOffset === 0xffffffff ||
    end + END_OF_DIRECTORY_BYTES + commentLength !== zip.length ||
    directoryOffset + directorySize !== end
  ) {
    throw new UnsupportedZip();
  }
  const entries = new Map<string, ZipEntry>();
  const order: ZipEntry[] = [];
  let at = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || zip.readUInt32LE(at) !== DIRECTORY_ENTRY) {
      throw new UnsupportedZip();
    }
    const flags = zip.readUInt16LE(at + 8);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const entryCommentLength = zip.readUInt16LE(at + 32);
    const recordStart = zip.readUInt32LE(at + 42);
    const directoryEnd =
      at + 46 + nameLength + extraLength + entryCommentLength;
    const nameBytes = zip.subarray(at + 46, at + 46 + nameLength);
    if (
      directoryEnd > end ||
      (flags & ENCRYPTED) !== 0 ||
      compressedSize === 0xffffffff ||
      size === 0xffffffff ||
      recordStart === 0xffffffff ||
      !isAsciiName(nameBytes) ||
      recordStart + 30 > directoryOffset ||
      zip.readUInt32LE(recordStart) !== LOCAL_ENTRY
    ) {
      throw new UnsupportedZip();
    }
    const name = nameBytes.toString('latin1');
    if (entries.has(name)) throw new UnsupportedZip();
    const dataStart =
      recordStart +
      30 +
      zip.readUInt16LE(recordStart + 26) +
      zip.readUInt16LE(recordStart + 28);
    const entry: ZipEntry = {
      name,
      flags,
      method: zip.readUInt16LE(at + 10),
      compressedSize,
      size,
      directoryStart: at,
      directoryEnd,
      recordStart,
      recordEnd: 0,
      dataStart,
    };
    entry.recordEnd = recordEnd(zip, entry, directoryOffset);
    if (entry.recordEnd > directoryOffset) throw new UnsupportedZip();
    entries.set(name, entry);
    order.push(entry);
    at = directoryEnd;
  }
  return { entries, order };
}

export function inflateEntry(zip: Buffer, entry: ZipEntry): Buffer {
  const data = zip.subarray(
    entry.dataStart,
    entry.dataStart + entry.compressedSize
  );
  let bytes: Buffer;
  if (entry.method === STORED) {
    bytes = data;
  } else if (entry.method === DEFLATED) {
    try {
      bytes = zlib.inflateRawSync(data, {
        maxOutputLength: Math.max(1, entry.size),
      });
    } catch {
      throw new UnsupportedZip();
    }
  } else {
    throw new UnsupportedZip();
  }
  if (bytes.length !== entry.size) throw new UnsupportedZip();
  return bytes;
}

function localHeader(name: Buffer, data: Buffer, crc: number): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_ENTRY, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  return header;
}

function directoryHeader(name: Buffer, data: Buffer, crc: number): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(DIRECTORY_ENTRY, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  return header;
}

// A copy of the zip with one entry's contents replaced (stored, uncompressed)
// and every other entry's record and directory entry copied byte for byte.
export function replaceZipEntry(
  zip: Buffer,
  directory: ZipDirectory,
  name: string,
  data: Buffer
): Buffer {
  const nameBytes = Buffer.from(name, 'latin1');
  const crc = zlib.crc32(data);
  const parts: Buffer[] = [localHeader(nameBytes, data, crc), nameBytes, data];
  const directoryParts: Buffer[] = [
    directoryHeader(nameBytes, data, crc),
    nameBytes,
  ];
  let offset = 30 + nameBytes.length + data.length;
  for (const entry of directory.order) {
    if (entry.name === name) continue;
    parts.push(zip.subarray(entry.recordStart, entry.recordEnd));
    const central = Buffer.from(
      zip.subarray(entry.directoryStart, entry.directoryEnd)
    );
    central.writeUInt32LE(offset, 42);
    directoryParts.push(central);
    offset += entry.recordEnd - entry.recordStart;
  }
  const directoryBytes = Buffer.concat(directoryParts);
  const count = directory.order.filter((entry) => entry.name !== name).length;
  const end = Buffer.alloc(END_OF_DIRECTORY_BYTES);
  end.writeUInt32LE(END_OF_DIRECTORY, 0);
  end.writeUInt16LE(count + 1, 8);
  end.writeUInt16LE(count + 1, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directoryBytes, end]);
}

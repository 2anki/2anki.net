import zlib from 'zlib';

// Zip files real tools do not write, for checking that directory reads stay
// bounded and agree with the converter's zip reader.

// The end records declare `declared` directory entries while the file holds
// none.
export function zipDeclaringMoreEntriesThanItHolds(declared: number): Buffer {
  const zip64End = Buffer.alloc(56);
  zip64End.writeUInt32LE(0x06064b50, 0);
  zip64End.writeBigUInt64LE(44n, 4);
  zip64End.writeBigUInt64LE(BigInt(declared), 24);
  zip64End.writeBigUInt64LE(BigInt(declared), 32);

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(0n, 8);
  locator.writeUInt32LE(1, 16);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);

  return Buffer.concat([zip64End, locator, end]);
}

// `bytes` of seeded noise followed by an end record that points its
// directory at the start of the noise.
export function noiseWithZipEnd(bytes: number): Buffer {
  const noise = Buffer.alloc(bytes);
  let seed = 7;
  for (let i = 0; i < bytes; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    noise[i] = seed >>> 16;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(bytes, 12);
  end.writeUInt32LE(0, 16);
  return Buffer.concat([noise, end]);
}

export interface ZipMember {
  name: string;
  data: Buffer;
}

// A deflated zip written member by member, so two members may share a name.
export function zipOfMembers(members: ZipMember[]): Buffer {
  const records: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name);
    const compressed = zlib.deflateRawSync(member.data);
    const crc = zlib.crc32(member.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(member.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(member.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    records.push(local, name, compressed);
    directory.push(central, name);
    offset += 30 + name.length + compressed.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, directoryBytes, end]);
}

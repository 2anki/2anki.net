// A zip whose end records declare `declared` directory entries while the file
// holds none, for checking that directory walks stay bounded.
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

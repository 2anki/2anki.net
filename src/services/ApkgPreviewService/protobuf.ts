interface ProtoField {
  fieldNumber: number;
  wireType: number;
  data: Buffer;
  // Decoded value for varint (wire type 0) fields; 0 for other wire types.
  value: number;
}

function decodeVarint(buf: Buffer, pos: number): [number, number] {
  let value = 0;
  let shift = 0;
  while (pos < buf.length) {
    const b = buf[pos++];
    value |= (b & 0x7f) << shift;
    shift += 7;
    if ((b & 0x80) === 0) break;
  }
  return [value, pos];
}

function skipField(wireType: number, buf: Buffer, pos: number): number {
  if (wireType === 0) {
    while (pos < buf.length && (buf[pos++] & 0x80) !== 0) {
      /* varint continuation bytes */
    }
    return pos;
  }
  if (wireType === 5) return pos + 4;
  if (wireType === 1) return pos + 8;
  return buf.length;
}

export function* iterFields(buf: Buffer): Generator<ProtoField> {
  let pos = 0;
  while (pos < buf.length) {
    let tag: number;
    [tag, pos] = decodeVarint(buf, pos);
    const fieldNumber = tag >> 3;
    const wireType = tag & 7;
    if (wireType === 2) {
      let len: number;
      [len, pos] = decodeVarint(buf, pos);
      yield {
        fieldNumber,
        wireType,
        data: buf.subarray(pos, pos + len),
        value: 0,
      };
      pos += len;
    } else if (wireType === 0) {
      let value: number;
      [value, pos] = decodeVarint(buf, pos);
      yield { fieldNumber, wireType, data: Buffer.alloc(0), value };
    } else {
      yield { fieldNumber, wireType, data: Buffer.alloc(0), value: 0 };
      pos = skipField(wireType, buf, pos);
    }
  }
}

export function readString(buf: Buffer, fieldNumber: number): string {
  for (const field of iterFields(buf)) {
    if (field.fieldNumber === fieldNumber && field.wireType === 2) {
      return field.data.toString('utf8');
    }
  }
  return '';
}

// Returns undefined when the field is absent — proto3 omits fields that
// hold their default value, so callers treat undefined as 0.
export function readVarint(
  buf: Buffer,
  fieldNumber: number
): number | undefined {
  for (const field of iterFields(buf)) {
    if (field.fieldNumber === fieldNumber && field.wireType === 0) {
      return field.value;
    }
  }
  return undefined;
}

export function readRepeatedSubmessages(
  buf: Buffer,
  fieldNumber: number
): Buffer[] {
  const results: Buffer[] = [];
  for (const field of iterFields(buf)) {
    if (field.fieldNumber === fieldNumber && field.wireType === 2) {
      results.push(field.data);
    }
  }
  return results;
}

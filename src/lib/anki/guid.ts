import { createHash } from 'crypto';

const BASE91_TABLE =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';

/**
 * Byte-for-byte port of genanki's guid_for (create_deck venv,
 * genanki/util.py). The 8-byte accumulator exceeds Number.MAX_SAFE_INTEGER,
 * so the arithmetic must stay in BigInt.
 */
export function guidFor(...values: Array<string | number>): string {
  const hashStr = values.map(String).join('__');
  const digest = createHash('sha256').update(hashStr, 'utf8').digest();

  let hashInt = 0n;
  for (const byte of digest.subarray(0, 8)) {
    hashInt = (hashInt << 8n) + BigInt(byte);
  }

  const base = BigInt(BASE91_TABLE.length);
  const reversed: string[] = [];
  while (hashInt > 0n) {
    reversed.push(BASE91_TABLE[Number(hashInt % base)]);
    hashInt /= base;
  }
  return reversed.reverse().join('');
}

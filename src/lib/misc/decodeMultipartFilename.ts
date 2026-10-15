const utf8 = new TextDecoder('utf-8', { fatal: true });

const isLatin1MojibakeCandidate = (name: string): boolean => {
  let hasHighByte = false;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code > 0xff) return false;
    if (code >= 0x80) hasHighByte = true;
  }
  return hasHighByte;
};

// multer (busboy) decodes a part's plain `filename="..."` parameter as latin1,
// but browsers send the raw UTF-8 bytes, so "PEDİATRİ" arrives as "PEDÄ°ATRÄ°".
// Re-reading the latin1 code units as UTF-8 recovers the original. A name that
// is not latin1 mojibake (it already holds a code point above U+00FF because
// the client sent `filename*`, or its bytes are not valid UTF-8 because it
// really was latin1) is returned unchanged rather than garbled further.
export function decodeMultipartFilename(name: string): string {
  if (!isLatin1MojibakeCandidate(name)) return name;
  try {
    return utf8.decode(Buffer.from(name, 'latin1'));
  } catch {
    return name;
  }
}

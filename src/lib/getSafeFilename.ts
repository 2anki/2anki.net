export function getSafeFilename(name: string) {
  return name.replace(/[/\\\0]/g, '-');
}

export function truncateToBytes(name: string, maxBytes: number): string {
  const encoded = Buffer.from(name, 'utf8');
  if (encoded.length <= maxBytes) {
    return name;
  }
  let end = maxBytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return encoded.slice(0, end).toString('utf8');
}

// For a download name built from an uploaded file's name: keeps letters,
// digits and combining marks in any script ("PEDİATRİ", "漢字") plus space,
// dot, underscore and hyphen, and turns everything else (path separators,
// quotes, control characters, punctuation) into "_".
export function toDownloadBasename(name: string): string {
  return name.replace(/[^\p{L}\p{M}\p{N} ._-]/gu, '_');
}

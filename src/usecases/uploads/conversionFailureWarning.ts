function baseName(filename: string): string {
  const normalized = filename.replaceAll('\\', '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

export function buildConversionFailureWarning(
  failedFilenames: string[]
): string | null {
  const names = failedFilenames.map(baseName).filter((n) => n.length > 0);
  if (names.length === 0) return null;

  if (names.length === 1) {
    return `${names[0]} could not be converted and was skipped. The rest of your upload converted — try uploading that file on its own.`;
  }

  const joined = names.join(', ');
  return `${names.length} files could not be converted and were skipped: ${joined}. The rest of your upload converted — try uploading them on their own.`;
}

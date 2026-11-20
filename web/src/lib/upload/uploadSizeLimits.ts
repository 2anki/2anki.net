const MEGABYTE = 1024 * 1024;

export const UPLOAD_FILE_FREE_MAX_BYTES = 100 * MEGABYTE;
export const UPLOAD_FILE_PAYING_MAX_BYTES = UPLOAD_FILE_FREE_MAX_BYTES * 100;
export const PDF_UNLOCK_MAX_BYTES = 50 * MEGABYTE;
export const THIN_DECK_PREVIEW_MAX_BYTES = 50 * MEGABYTE;
export const APKG_TOOL_MAX_BYTES = 100 * MEGABYTE;

export function findOversizedFile<T extends { size: number }>(
  files: readonly T[],
  maxBytes: number
): T | undefined {
  return files.find((file) => file.size > maxBytes);
}

export function megabytesLabel(bytes: number): string {
  return `${bytes / MEGABYTE} MB`;
}

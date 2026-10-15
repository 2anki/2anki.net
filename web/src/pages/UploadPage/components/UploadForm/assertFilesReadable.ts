/**
 * A picked File is a snapshot (name, size, mtime). Once the file on disk is
 * saved again, moved or deleted, the browser refuses to read it: Chrome
 * rejects the upload with `net::ERR_UPLOAD_FILE_CHANGED`, which surfaces
 * as a bare "Failed to fetch", and a same-file retry can never succeed.
 * Reading one byte before the request turns that into a `NotReadableError`
 * we can name, so the form asks for a fresh pick instead of a retry.
 */
export type UnreadableFileReason = 'changed' | 'empty';

export class UnreadableFileError extends Error {
  constructor(
    readonly file: File,
    readonly reason: UnreadableFileReason = 'changed'
  ) {
    super(`Cannot read ${file.name}`);
    this.name = 'UnreadableFileError';
  }
}

// A 0-byte pick is most often a cloud placeholder (OneDrive Files On-Demand,
// iCloud Drive, Google Drive stream) that has not been downloaded to the disk
// yet: the picker reports it, the one-byte read below has nothing to read, and
// the upload then dies with a bare "Failed to fetch" that no retry can fix.
// A pick with no content at all can never become a deck, so it is named
// before the request instead of after. A batch that still carries content
// goes through: the server tolerates an empty companion file.
export async function assertFilesReadable(files: File[]): Promise<void> {
  if (files.length > 0 && files.every((file) => file.size === 0)) {
    throw new UnreadableFileError(files[0], 'empty');
  }
  for (const file of files) {
    try {
      await file.slice(0, 1).arrayBuffer();
    } catch {
      throw new UnreadableFileError(file);
    }
  }
}

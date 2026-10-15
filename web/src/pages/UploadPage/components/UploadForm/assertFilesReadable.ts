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
// the upload then dies with a bare "Failed to fetch" that no retry can fix
// (36 events from 14 uploaders between 2026-09-28 and 2026-10-15, two thirds of
// whom never converted anything afterwards). An empty file can never become a
// deck either way, so name it before the request instead of after.
export async function assertFilesReadable(files: File[]): Promise<void> {
  for (const file of files) {
    if (file.size === 0) {
      throw new UnreadableFileError(file, 'empty');
    }
    try {
      await file.slice(0, 1).arrayBuffer();
    } catch {
      throw new UnreadableFileError(file);
    }
  }
}

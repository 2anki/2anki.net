/**
 * A picked File is a snapshot (name, size, mtime). Once the file on disk is
 * saved again, moved or deleted, the browser refuses to read it: Chrome
 * rejects the upload with `net::ERR_UPLOAD_FILE_CHANGED`, which surfaces
 * as a bare "Failed to fetch", and a same-file retry can never succeed.
 * Reading one byte before the request turns that into a `NotReadableError`
 * we can name, so the form asks for a fresh pick instead of a retry.
 */
export class UnreadableFileError extends Error {
  constructor(readonly file: File) {
    super(`Cannot read ${file.name}`);
    this.name = 'UnreadableFileError';
  }
}

export async function assertFilesReadable(files: File[]): Promise<void> {
  for (const file of files) {
    try {
      await file.slice(0, 1).arrayBuffer();
    } catch {
      throw new UnreadableFileError(file);
    }
  }
}

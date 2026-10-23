/**
 * A picked File is a snapshot (name, size, mtime). Once the file on disk is
 * saved again, moved or deleted, the browser refuses to read it: Chrome
 * rejects the upload with `net::ERR_UPLOAD_FILE_CHANGED`, which surfaces
 * as a bare "Failed to fetch", and a same-file retry can never succeed.
 * Reading one byte before the request turns that into a `NotReadableError`
 * we can name, so the form asks for a fresh pick instead of a retry.
 */
export type UnreadableFileReason = 'changed' | 'empty' | 'partial';

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

// Files up to this size are copied into memory before the request; larger
// picks stream from disk as before, so a huge upload cannot exhaust the tab.
export const SNAPSHOT_MAX_BYTES = 100 * 1024 * 1024;

async function copyIntoMemory(file: File): Promise<File> {
  try {
    const bytes = await file.arrayBuffer();
    return new File([bytes], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } catch {
    throw new UnreadableFileError(file, 'partial');
  }
}

// The one-byte probe above passes for a cloud file whose first bytes are on
// the disk and whose rest is not, and for a file saved again after the pick;
// the request then dies a second in with "Failed to fetch" or Safari's "Load
// failed" before the server sees a byte, and every retry dies the same way.
// Reading the whole file first names that case, and the request then sends a
// copy that no later change on the disk can break.
export async function snapshotUploadBody(
  formData: FormData,
  files: File[]
): Promise<FormData> {
  await assertFilesReadable(files);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > SNAPSHOT_MAX_BYTES) return formData;
  const copies: File[] = [];
  for (const file of files) {
    copies.push(await copyIntoMemory(file));
  }
  // The form's file entries are the picked files in pick order; each one is
  // swapped for its copy, and an entry that does not line up is sent as is.
  const snapshot = new FormData();
  let fileIndex = 0;
  for (const [key, value] of formData.entries()) {
    const copy = value instanceof File ? copies[fileIndex++] : undefined;
    if (copy != null && copy.name === (value as File).name) {
      snapshot.append(key, copy);
    } else {
      snapshot.append(key, value);
    }
  }
  return snapshot;
}

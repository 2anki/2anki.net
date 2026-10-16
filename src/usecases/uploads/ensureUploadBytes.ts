import fs from 'node:fs';
import path from 'node:path';
import { UploadedFile } from '../../lib/storage/types';

// Multer disk storage gives each upload a `path` but no `buffer`. The conversion
// runs later in a Piscina worker that reads the file lazily; the temp file under
// UPLOAD_BASE can vanish before the worker reads it, and the job dies with
// "Uploaded file is no longer available on disk and has no buffer fallback".
//
// Called from the multer callback in GetUploadHandler — the instant the upload
// finishes writing, before any async hop (auth, settings lookup, the Piscina
// queue) — so the bytes are captured while the file is provably on disk. This
// populates the worker's buffer fallback so the conversion survives the reaping.
// The worker still prefers the disk path on the happy path; the buffer only
// matters when the file vanished. (#3414 / supersedes #3416's late snapshot.)
// Above this size the eager snapshot is skipped: duplicating a multi-hundred-MB
// upload into main-process memory (and then structured-cloning it into the
// worker) costs more than the reap-window risk it insures against. Big uploads
// rely on the disk path the worker already prefers; the buffer fallback stays
// for the small-file majority.
export const SNAPSHOT_MAX_BYTES = 64 * 1024 * 1024;

// Stream flags the multer callback knows; logged verbatim, never branched on.
export interface UploadRequestState {
  complete: boolean | undefined;
  readableEnded: boolean | undefined;
  aborted: boolean | undefined;
  destroyed: boolean | undefined;
  headersSent: boolean | undefined;
}

// The question is "empty or populated", not an exact count: the directory
// once held hundreds of thousands of entries, and listing all of them inside
// a live request's multer callback would block the event loop for nothing.
export const DIR_ENTRIES_CAP = 1000;

interface UploadDirState {
  dirExists: boolean;
  dirEntries: number | null;
  dirEntriesCapped: boolean;
  dirError: string | null;
}

function uploadDirState(filePath: string): UploadDirState {
  const dir = path.dirname(filePath);
  try {
    const handle = fs.opendirSync(dir);
    let entries = 0;
    try {
      while (entries < DIR_ENTRIES_CAP && handle.readSync() != null) {
        entries += 1;
      }
    } finally {
      handle.closeSync();
    }
    return {
      dirExists: true,
      dirEntries: entries,
      dirEntriesCapped: entries >= DIR_ENTRIES_CAP,
      dirError: null,
    };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    const dirError = typeof code === 'string' ? code : String(error);
    // Only ENOENT means the directory is gone; EACCES or EMFILE is a listing
    // failure on a directory that is still there, and must read as such.
    return {
      dirExists: dirError !== 'ENOENT',
      dirEntries: null,
      dirEntriesCapped: false,
      dirError,
    };
  }
}

export function ensureUploadBytes(
  files: UploadedFile[],
  request?: UploadRequestState
): void {
  const unreadable: { file: UploadedFile; error: unknown }[] = [];
  for (const file of files) {
    if (file.buffer != null || !file.path) continue;
    if (file.size > SNAPSHOT_MAX_BYTES) continue;
    try {
      file.buffer = fs.readFileSync(file.path);
    } catch (error) {
      // The file is already gone or unreadable at request time. Leave the
      // buffer unset; the worker surfaces its own clear error if the disk read
      // also fails by the time it runs.
      unreadable.push({ file, error });
    }
  }
  if (unreadable.length > 0) {
    // One line per request, not per file: an aborted multi-file upload used to
    // dump 4 log lines for each of its dozens of vanished temp files (#4173).
    // Since 2026-09-01 the multer callback has handed back paths that are
    // already gone (ENOENT on every file, no multer error, #4761), so the line
    // carries what tells a vanished directory from an unlinked file: the
    // parent directory's state, the size multer reported after writing, and
    // the request's stream flags.
    const first = unreadable[0];
    console.warn('[upload] could not snapshot upload bytes', {
      count: unreadable.length,
      total: files.length,
      firstFile: path.basename(first.file.path),
      firstError: String(first.error),
      firstCode: (first.error as { code?: unknown })?.code ?? null,
      firstSize: first.file.size ?? null,
      ...uploadDirState(first.file.path),
      request: request ?? null,
    });
  }
}

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

export function ensureUploadBytes(files: UploadedFile[]): void {
  for (const file of files) {
    if (file.buffer != null || !file.path) continue;
    if (file.size > SNAPSHOT_MAX_BYTES) continue;
    try {
      file.buffer = fs.readFileSync(file.path);
    } catch (error) {
      // The file is already gone or unreadable at request time (rare). Leave the
      // buffer unset; the worker surfaces its own clear error if the disk read
      // also fails by the time it runs.
      console.warn('[upload] could not snapshot upload bytes', {
        file: path.basename(file.path),
        error: String(error),
      });
    }
  }
}

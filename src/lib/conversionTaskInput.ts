import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRandomUUID } from '../shared/helpers/getRandomUUID';
import type { UploadedFile } from './storage/types';
import type { UploadGenerationTask } from '../usecases/uploads/uploadGenerationTypes';

// Pinned task inputs live here, deliberately NOT under UPLOAD_BASE or
// WORKSPACE_BASE: the 2h filesystem sweep clears those two roots and would
// delete a queued task's input out from under a child that has not run yet.
// os.tmpdir() is swept only by the 24h boot cleanup (clearStaleConversionTaskDirs).
export function conversionTaskBase(): string {
  return path.join(os.tmpdir(), '2anki-conversion-tasks');
}

async function pinOne(
  file: UploadedFile,
  destDir: string,
  index: number
): Promise<UploadedFile> {
  const safeName = path.basename(file.originalname || `file-${index}`);
  const dest = path.join(destDir, `${index}-${safeName}`);
  if (file.path && fs.existsSync(file.path)) {
    // Hardlink is free (no copy, no extra inode data); it falls back to a copy
    // across filesystem boundaries (EXDEV) or when the source is unlinkable.
    try {
      await fsp.link(file.path, dest);
    } catch {
      await fsp.copyFile(file.path, dest);
    }
  } else if (file.buffer != null) {
    await fsp.writeFile(dest, file.buffer);
  } else {
    // GeneratePackagesUseCase rejects unavailable uploads before this runs, so
    // this only guards against a torn upload racing the pin — write an empty
    // file so the child surfaces its own clear "no cards" error, not an ENOENT.
    await fsp.writeFile(dest, Buffer.alloc(0));
  }
  return {
    fieldname: file.fieldname,
    originalname: file.originalname,
    encoding: file.encoding,
    mimetype: file.mimetype,
    size: file.size,
    destination: file.destination,
    filename: file.filename,
    key: file.key,
    path: dest,
    // The child reads bytes from `path`; the buffer is never sent over IPC, and
    // a raw Multer stream would not survive v8 serialization either.
    buffer: undefined as never,
    stream: null as never,
  };
}

export interface PinnedTask {
  task: UploadGenerationTask;
  cleanup: () => Promise<void>;
}

export async function pinConversionTaskInput(
  task: UploadGenerationTask
): Promise<PinnedTask> {
  const base = conversionTaskBase();
  const dir = path.join(base, getRandomUUID());
  await fsp.mkdir(dir, { recursive: true });
  const files = await Promise.all(
    task.files.map((file, index) => pinOne(file, dir, index))
  );
  return {
    task: { ...task, files },
    cleanup: async () => {
      await fsp.rm(dir, { recursive: true, force: true });
    },
  };
}

export async function clearStaleConversionTaskDirs(
  maxAgeMs: number
): Promise<number> {
  const base = conversionTaskBase();
  let names: string[];
  try {
    names = await fsp.readdir(base);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of names) {
    const entry = path.join(base, name);
    try {
      const stat = await fsp.lstat(entry);
      if (stat.mtimeMs < cutoff) {
        await fsp.rm(entry, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // Already gone or unreadable; nothing to clean.
    }
  }
  return removed;
}

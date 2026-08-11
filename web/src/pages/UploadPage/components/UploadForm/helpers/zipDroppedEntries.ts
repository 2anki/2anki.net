import { zip } from 'fflate';
import type { DroppedFile } from './collectDroppedEntries';

// Notion exports are HTML plus already-compressed images, so store (level 0)
// skips burning CPU on incompressible bytes — the server only needs a valid
// archive, not a small one.
export async function zipDroppedFiles(
  folderName: string,
  files: DroppedFile[]
): Promise<File> {
  const entries: Record<string, Uint8Array> = {};
  for (const { path, file } of files) {
    entries[path] = new Uint8Array(await file.arrayBuffer());
  }
  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (error, data) => {
      if (error != null) {
        reject(error);
        return;
      }
      resolve(data);
    });
  });
  const safeName = folderName.trim().length > 0 ? folderName.trim() : 'upload';
  return new File([zipped as BlobPart], `${safeName}.zip`, {
    type: 'application/zip',
  });
}

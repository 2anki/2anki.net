import { unzipSync } from 'fflate';

// A zip's end record says how many directory entries follow, and fflate walks
// that many whether or not the file holds them. The walk is bounded by what
// the file could physically contain (no directory entry is smaller than 46
// bytes) and by a fixed ceiling, so a small file cannot keep a process busy;
// past the bound the directory counts as unreadable.
const SMALLEST_DIRECTORY_ENTRY_BYTES = 46;
export const MAX_ZIP_DIRECTORY_ENTRIES = 200_000;

export interface ZipDirectoryEntry {
  name: string;
  compressedSize: number;
  originalSize: number;
}

export type ZipDirectoryWalk = 'complete' | 'stopped' | 'unreadable';

class StopWalking extends Error {}

// Reads the directory without inflating any entry. `visit` returns 'stop'
// once it has what it needs.
export function walkZipDirectory(
  contents: Uint8Array,
  visit: (entry: ZipDirectoryEntry) => 'stop' | 'continue'
): ZipDirectoryWalk {
  const bytes = new Uint8Array(
    contents.buffer,
    contents.byteOffset,
    contents.byteLength
  );
  const limit = Math.min(
    Math.floor(bytes.length / SMALLEST_DIRECTORY_ENTRY_BYTES),
    MAX_ZIP_DIRECTORY_ENTRIES
  );
  let seen = 0;
  let stopped = false;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        seen += 1;
        if (seen > limit) throw new StopWalking();
        const next = visit({
          name: file.name,
          compressedSize: file.size,
          originalSize: file.originalSize,
        });
        if (next === 'stop') {
          stopped = true;
          throw new StopWalking();
        }
        return false;
      },
    });
  } catch {
    return stopped ? 'stopped' : 'unreadable';
  }
  return 'complete';
}

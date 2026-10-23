import { unzip, type Unzipped } from 'fflate';

const PHOTO_TYPES = new Map<string, string>([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
  ['heic', 'image/heic'],
  ['heif', 'image/heif'],
]);

// Photo to Deck reads each photo with one AI call when the person presses
// Make cards, so a handed-over zip loads at most this many.
export const MAX_HANDOFF_PHOTOS = 20;
// Photo to Deck refuses photos over this size, so they are not handed over.
export const MAX_HANDOFF_PHOTO_BYTES = 10 * 1024 * 1024;

export interface UploadPhotos {
  photos: File[];
  skipped: number;
}

function photoType(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return undefined;
  return PHOTO_TYPES.get(name.slice(dot + 1).toLowerCase());
}

export function isPhotoName(name: string): boolean {
  return photoType(name) != null;
}

export function isHeicPhoto(file: File): boolean {
  return /\.(heic|heif)$/i.test(file.name);
}

function isPackingNoise(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return (
    path.endsWith('/') || path.startsWith('__MACOSX/') || base.startsWith('.')
  );
}

function unzipFile(file: File): Promise<Unzipped> {
  return file.arrayBuffer().then(
    (buffer) =>
      new Promise((resolve, reject) => {
        unzip(
          new Uint8Array(buffer),
          {
            filter: (entry) =>
              !isPackingNoise(entry.name) && isPhotoName(entry.name),
          },
          (error, entries) => (error ? reject(error) : resolve(entries))
        );
      })
  );
}

// The photos an upload holds: the picked photos themselves, or the photos
// inside a picked zip, in name order, capped for Photo to Deck.
export async function photosFromUpload(files: File[]): Promise<UploadPhotos> {
  const found: File[] = [];
  for (const file of files) {
    if (isPhotoName(file.name)) {
      found.push(file);
    } else if (/\.zip$/i.test(file.name)) {
      const entries = await unzipFile(file);
      for (const name of Object.keys(entries).sort()) {
        const base = name.slice(name.lastIndexOf('/') + 1);
        found.push(new File([entries[name]], base, { type: photoType(name) }));
      }
    }
  }
  const usable = found.filter((photo) => photo.size <= MAX_HANDOFF_PHOTO_BYTES);
  const photos = usable.slice(0, MAX_HANDOFF_PHOTOS);
  return { photos, skipped: found.length - photos.length };
}

// Router state the upload page hands to Photo to Deck.
export const HANDOFF_PHOTOS_STATE_KEY = 'handoffPhotos';
export const HANDOFF_SKIPPED_STATE_KEY = 'handoffSkipped';

export interface PhotoHandoff {
  photos: File[];
  skipped: number;
}

export function readPhotoHandoff(state: unknown): PhotoHandoff | null {
  if (state == null || typeof state !== 'object') return null;
  const record = state as Record<string, unknown>;
  const photos = record[HANDOFF_PHOTOS_STATE_KEY];
  if (!Array.isArray(photos)) return null;
  const files = photos.filter((photo): photo is File => photo instanceof File);
  if (files.length === 0) return null;
  const skipped = record[HANDOFF_SKIPPED_STATE_KEY];
  return {
    photos: files,
    skipped: typeof skipped === 'number' && skipped > 0 ? skipped : 0,
  };
}

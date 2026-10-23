import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  isPhotoName,
  MAX_HANDOFF_PHOTO_BYTES,
  MAX_HANDOFF_PHOTOS,
  photosFromUpload,
} from './photosFromUpload';

function zipFile(name: string, entries: Record<string, string>): File {
  const encoded: Record<string, Uint8Array> = {};
  for (const [entry, body] of Object.entries(entries)) {
    encoded[entry] = new TextEncoder().encode(body);
  }
  return new File([zipSync(encoded)], name, { type: 'application/zip' });
}

describe('photosFromUpload', () => {
  it('passes picked photos through, HEIC included', async () => {
    const heic = new File(['h'], 'IMG_0001.HEIC', { type: 'image/heic' });
    const jpg = new File(['j'], 'board.jpg', { type: 'image/jpeg' });

    expect(await photosFromUpload([heic, jpg])).toEqual({
      photos: [heic, jpg],
      skipped: 0,
    });
  });

  it('takes the photos out of a zip in name order, without the packing noise', async () => {
    const upload = zipFile('slides.zip', {
      'slides/02.png': 'two',
      'slides/01.png': 'one',
      '__MACOSX/slides/._01.png': 'fork',
      'slides/.DS_Store': 'x',
      'slides/notes.txt': 'not a photo',
    });

    const { photos, skipped } = await photosFromUpload([upload]);

    expect(photos.map((p) => p.name)).toEqual(['01.png', '02.png']);
    expect(photos.map((p) => p.type)).toEqual(['image/png', 'image/png']);
    expect(await photos[0].text()).toBe('one');
    expect(skipped).toBe(0);
  });

  it('loads at most the handoff cap and counts the rest', async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < MAX_HANDOFF_PHOTOS + 3; i += 1) {
      entries[`p${String(i).padStart(2, '0')}.jpg`] = String(i);
    }

    const { photos, skipped } = await photosFromUpload([
      zipFile('many.zip', entries),
    ]);

    expect(photos).toHaveLength(MAX_HANDOFF_PHOTOS);
    expect(skipped).toBe(3);
  });

  it('counts photos too large for Photo to Deck as left out', async () => {
    const big = new File(['b'], 'huge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: MAX_HANDOFF_PHOTO_BYTES + 1 });
    const small = new File(['s'], 'small.jpg', { type: 'image/jpeg' });

    expect(await photosFromUpload([big, small])).toEqual({
      photos: [small],
      skipped: 1,
    });
  });

  it('ignores files that are neither photos nor zips', async () => {
    expect(await photosFromUpload([new File(['x'], 'notes.pdf')])).toEqual({
      photos: [],
      skipped: 0,
    });
  });
});

describe('isPhotoName', () => {
  it.each(['a.jpg', 'a.JPEG', 'a.png', 'a.webp', 'a.gif', 'a.heic', 'a.heif'])(
    'knows %s',
    (name) => {
      expect(isPhotoName(name)).toBe(true);
    }
  );

  it('is false for other files', () => {
    expect(isPhotoName('a.pdf')).toBe(false);
  });
});

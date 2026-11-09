import { vi, type MockedFunction } from 'vitest';
import { strToU8 } from 'fflate';

import { decompress } from './decompress';
import { processAndPrepareArchiveData } from './processAndPrepareArchiveData';
import { File } from './types';
import { RECOVERY_TOO_LARGE_MESSAGE } from './unpack';

vi.mock('./decompress');

const mockedDecompress = decompress as MockedFunction<typeof decompress>;
const archive = strToU8('archive bytes');

function fileOnDisk(
  name: string,
  text: string
): { file: File; reads: () => number } {
  let reads = 0;
  const file: File = { name, size: text.length };
  Object.defineProperty(file, 'contents', {
    enumerable: true,
    get() {
      reads += 1;
      return strToU8(text);
    },
  });
  return { file, reads: () => reads };
}

describe('processAndPrepareArchiveData', () => {
  beforeEach(() => {
    mockedDecompress.mockReset();
  });

  it('decodes supported files and leaves other files unread on disk', async () => {
    const page = fileOnDisk('/w/page.html', '<p>hi</p>');
    const photo = fileOnDisk('/w/photo.png', 'png bytes');
    mockedDecompress.mockResolvedValue([page.file, photo.file]);

    const files = await processAndPrepareArchiveData(archive);

    expect(files[0]).toEqual({ name: '/w/page.html', contents: '<p>hi</p>' });
    expect(files[1].name).toBe('/w/photo.png');
    expect(photo.reads()).toBe(0);
  });

  it('refuses before reading text past the memory budget', async () => {
    const small = fileOnDisk('/w/a.html', 'aaaa');
    const large = fileOnDisk('/w/b.html', 'b'.repeat(100));
    mockedDecompress.mockResolvedValue([small.file, large.file]);

    await expect(
      processAndPrepareArchiveData(archive, false, 50)
    ).rejects.toThrow(RECOVERY_TOO_LARGE_MESSAGE);
    expect(large.reads()).toBe(0);
  });
});

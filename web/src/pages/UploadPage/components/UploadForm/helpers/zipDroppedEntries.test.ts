import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { zipDroppedFiles } from './zipDroppedEntries';

describe('zipDroppedFiles', () => {
  it('round-trips entry names and bytes through a real zip', async () => {
    const zipFile = await zipDroppedFiles('Export', [
      {
        path: 'Export/Page.html',
        file: new File(['<html>page</html>'], 'Page.html'),
      },
      {
        path: 'Export/images/a.png',
        file: new File(['png-bytes'], 'a.png'),
      },
    ]);

    expect(zipFile.name).toBe('Export.zip');
    expect(zipFile.type).toBe('application/zip');

    const unzipped = unzipSync(new Uint8Array(await zipFile.arrayBuffer()));
    expect(Object.keys(unzipped).sort()).toEqual([
      'Export/Page.html',
      'Export/images/a.png',
    ]);
    expect(strFromU8(unzipped['Export/Page.html'])).toBe('<html>page</html>');
  });

  it('falls back to a generic archive name for a blank folder name', async () => {
    const zipFile = await zipDroppedFiles('  ', [
      { path: 'Page.html', file: new File(['<p>x</p>'], 'Page.html') },
    ]);

    expect(zipFile.name).toBe('upload.zip');
  });
});

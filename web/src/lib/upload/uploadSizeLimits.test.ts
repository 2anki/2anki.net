import { describe, expect, it } from 'vitest';
import {
  UPLOAD_FILE_FREE_MAX_BYTES,
  findOversizedFile,
  megabytesLabel,
} from './uploadSizeLimits';

const sized = (name: string, size: number) => ({ name, size });

describe('findOversizedFile', () => {
  it('names the first file one byte over the limit', () => {
    const files = [
      sized('fits.pdf', 10),
      sized('big.pdf', UPLOAD_FILE_FREE_MAX_BYTES + 1),
      sized('bigger.pdf', UPLOAD_FILE_FREE_MAX_BYTES + 2),
    ];
    expect(findOversizedFile(files, UPLOAD_FILE_FREE_MAX_BYTES)).toEqual(
      files[1]
    );
  });

  it('lets a file exactly at the limit through', () => {
    expect(
      findOversizedFile(
        [sized('exact.pdf', UPLOAD_FILE_FREE_MAX_BYTES)],
        UPLOAD_FILE_FREE_MAX_BYTES
      )
    ).toBeUndefined();
  });
});

describe('megabytesLabel', () => {
  it('writes the free upload limit the way the limit copy says it', () => {
    expect(megabytesLabel(UPLOAD_FILE_FREE_MAX_BYTES)).toBe('100 MB');
  });
});

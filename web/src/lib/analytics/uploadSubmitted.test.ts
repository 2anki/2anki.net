import { uploadSubmittedProps } from './uploadSubmitted';

function file(name: string, size: number): File {
  const f = new File([''], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const MB = 1024 * 1024;

describe('uploadSubmittedProps', () => {
  it.each([
    ['notes.PDF', 'pdf'],
    ['export.zip', 'zip'],
    ['slides.pptx', 'pptx'],
    ['my secret thesis.weird', 'other'],
    ['no-extension', 'unknown'],
    ['trailing-dot.', 'unknown'],
  ])('maps %s to the file type %s, never the name', (name, fileExt) => {
    expect(uploadSubmittedProps([file(name, 10)], false).fileExt).toBe(fileExt);
  });

  it.each([
    [0, '<1MB'],
    [MB - 1, '<1MB'],
    [MB, '1-5MB'],
    [5 * MB, '5-25MB'],
    [25 * MB, '25-100MB'],
    [100 * MB, '>=100MB'],
  ])('buckets %i bytes as %s', (bytes, sizeBucket) => {
    expect(uploadSubmittedProps([file('a.pdf', bytes)], false).sizeBucket).toBe(
      sizeBucket
    );
  });

  it('sums the size of every file and counts them', () => {
    expect(
      uploadSubmittedProps([file('a.md', 3 * MB), file('b.md', 3 * MB)], true)
    ).toEqual({
      fileExt: 'md',
      sizeBucket: '5-25MB',
      fileCount: 2,
      retry: true,
    });
  });

  it('reports no file type for an empty selection', () => {
    expect(uploadSubmittedProps([], false)).toEqual({
      fileExt: 'unknown',
      sizeBucket: '<1MB',
      fileCount: 0,
      retry: false,
    });
  });
});

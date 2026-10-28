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
    ['__proto__.constructor', 'other'],
    ['no-extension', 'unknown'],
    ['trailing-dot.', 'unknown'],
  ])('maps %s to the input format %s, never the name', (name, format) => {
    expect(uploadSubmittedProps([file(name, 10)], 'submit').input_format).toBe(
      format
    );
  });

  it.each([
    [0, '<1MB'],
    [MB - 1, '<1MB'],
    [MB, '1-5MB'],
    [5 * MB, '5-25MB'],
    [25 * MB, '25-100MB'],
    [100 * MB, '>=100MB'],
  ])('buckets %i bytes as %s', (bytes, bucket) => {
    expect(
      uploadSubmittedProps([file('a.pdf', bytes)], 'submit').size_bucket
    ).toBe(bucket);
  });

  it.each([
    ['submit', false],
    ['handoff', false],
    ['resume', true],
    ['retry', true],
    ['resend', true],
  ] as const)('marks a %s send retry: %s', (trigger, retry) => {
    expect(uploadSubmittedProps([file('a.md', 1)], trigger)).toMatchObject({
      trigger,
      retry,
    });
  });

  it('sums the size of every file and counts them', () => {
    expect(
      uploadSubmittedProps(
        [file('a.md', 3 * MB), file('b.md', 3 * MB)],
        'submit'
      )
    ).toEqual({
      input_format: 'md',
      size_bucket: '5-25MB',
      file_count: 2,
      trigger: 'submit',
      retry: false,
    });
  });
});

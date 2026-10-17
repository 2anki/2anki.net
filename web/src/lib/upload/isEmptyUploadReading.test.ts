import { isEmptyUploadReading } from './isEmptyUploadReading';

describe('isEmptyUploadReading', () => {
  it.each([
    [
      'a document reading',
      {
        kind: 'document',
        words: 1,
        headings: 0,
        listItems: 0,
        tables: 0,
        toggles: 0,
        images: 0,
      },
      true,
    ],
    [
      'a zip reading',
      {
        kind: 'zip',
        files: 2,
        readable: 0,
        archives: 0,
        imageFiles: 2,
        otherFiles: 0,
      },
      true,
    ],
    ['null', null, false],
    ['an unknown kind', { kind: 'pdf', words: 1 }, false],
    [
      'a negative count',
      {
        kind: 'document',
        words: -1,
        headings: 0,
        listItems: 0,
        tables: 0,
        toggles: 0,
        images: 0,
      },
      false,
    ],
    ['a missing field', { kind: 'zip', files: 2, readable: 0 }, false],
  ])('judges %s', (_label, value, expected) => {
    expect(isEmptyUploadReading(value)).toBe(expected);
  });
});

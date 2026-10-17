import i18n from 'i18next';

import { describeEmptyReading, formatCount } from './describeEmptyReading';

const t = i18n.getFixedT('en');

function document(
  counts: Partial<{
    words: number;
    headings: number;
    listItems: number;
    tables: number;
    toggles: number;
    images: number;
  }>
) {
  return {
    kind: 'document' as const,
    words: 0,
    headings: 0,
    listItems: 0,
    tables: 0,
    toggles: 0,
    images: 0,
    ...counts,
  };
}

function zip(
  counts: Partial<{
    files: number;
    readable: number;
    archives: number;
    imageFiles: number;
    otherFiles: number;
  }>
) {
  return {
    kind: 'zip' as const,
    files: 0,
    readable: 0,
    archives: 0,
    imageFiles: 0,
    otherFiles: 0,
    ...counts,
  };
}

describe('describeEmptyReading', () => {
  it('lists what was read and points at toggles when headings were already tried', () => {
    expect(
      describeEmptyReading(
        document({ words: 3200, headings: 14, tables: 1 }),
        t,
        'en'
      )
    ).toEqual({
      text: 'We read 3200 words, 14 headings, and 1 table. Nothing in it is shaped like a card: no toggles and no question-and-answer pairs.',
      next: 'readingNextToggles',
    });
  });

  it('offers toggles or headings when the document has neither', () => {
    expect(
      describeEmptyReading(document({ words: 800, listItems: 6 }), t, 'en')
    ).toEqual({
      text: 'We read 800 words and 6 list items. Nothing in it is shaped like a card: no toggles and no question-and-answer pairs.',
      next: 'readingNext',
    });
  });

  it('blames empty toggles and asks for answers when toggles were there', () => {
    expect(
      describeEmptyReading(document({ words: 40, toggles: 1 }), t, 'en')
    ).toEqual({
      text: 'We read 40 words. 1 toggle had nothing inside it to use as an answer.',
      next: 'readingNextAnswers',
    });
  });

  it('ends on its own instruction when a file had no readable text', () => {
    expect(describeEmptyReading(document({ images: 2 }), t, 'en')).toEqual({
      text: 'This file has no text we can read. Upload the file that holds your notes.',
      next: null,
    });
  });

  it('describes a zip of images with nothing readable', () => {
    expect(
      describeEmptyReading(
        zip({ files: 71, imageFiles: 70, otherFiles: 1 }),
        t,
        'en'
      )
    ).toEqual({
      text: "This zip holds 70 image files and 1 file in a format we can't read. None of them is a file we can read. Export your notes as HTML and upload that.",
      next: null,
    });
  });

  it('describes a zip whose pages read but paired nothing', () => {
    expect(
      describeEmptyReading(
        zip({ files: 3, readable: 1, imageFiles: 2 }),
        t,
        'en'
      )
    ).toEqual({
      text: 'This zip holds 1 readable file and 2 image files. Nothing in it is shaped like a card: no toggles and no question-and-answer pairs.',
      next: 'readingNext',
    });
  });

  it('treats a wrapper zip holding another zip as read, not unreadable', () => {
    expect(
      describeEmptyReading(zip({ files: 1, archives: 1 }), t, 'en')
    ).toEqual({
      text: 'This zip holds 1 nested zip. Nothing in it is shaped like a card: no toggles and no question-and-answer pairs.',
      next: 'readingNext',
    });
  });

  it('names an empty zip', () => {
    expect(describeEmptyReading(zip({}), t, 'en')).toEqual({
      text: 'This zip is empty. Upload the export that holds your notes.',
      next: null,
    });
  });

  it('groups thousands with a thin space from ten thousand up', () => {
    expect(formatCount(9999)).toBe('9999');
    expect(formatCount(12450)).toBe('12\u2009450');
    expect(formatCount(1234567)).toBe('1\u2009234\u2009567');
    expect(
      describeEmptyReading(document({ words: 12450 }), t, 'en').text
    ).toContain('12\u2009450 words');
  });
});

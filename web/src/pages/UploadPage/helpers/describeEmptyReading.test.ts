import i18n from 'i18next';

import { describeEmptyReading } from './describeEmptyReading';

const t = i18n.getFixedT('en');

describe('describeEmptyReading', () => {
  it('lists what was read and says nothing was card-shaped', () => {
    expect(
      describeEmptyReading(
        {
          kind: 'document',
          words: 3200,
          headings: 14,
          listItems: 0,
          tables: 1,
          toggles: 0,
          images: 0,
        },
        t,
        'en'
      )
    ).toBe(
      'We read 3200 words, 14 headings, and 1 table. Nothing in it is shaped like a card: no toggles and no question-and-answer pairs.'
    );
  });

  it('blames empty toggles when the page had toggles with nothing inside', () => {
    expect(
      describeEmptyReading(
        {
          kind: 'document',
          words: 40,
          headings: 0,
          listItems: 0,
          tables: 0,
          toggles: 1,
          images: 0,
        },
        t,
        'en'
      )
    ).toBe(
      'We read 40 words. 1 toggle had nothing inside it to use as an answer.'
    );
  });

  it('says when a file had no readable text', () => {
    expect(
      describeEmptyReading(
        {
          kind: 'document',
          words: 0,
          headings: 0,
          listItems: 0,
          tables: 0,
          toggles: 0,
          images: 2,
        },
        t,
        'en'
      )
    ).toBe('This file has no text we can read.');
  });

  it('describes a zip of images with no readable page', () => {
    expect(
      describeEmptyReading(
        { kind: 'zip', files: 71, readable: 0, imageFiles: 70, otherFiles: 1 },
        t,
        'en'
      )
    ).toBe(
      'This zip holds 70 image files and 1 file in a format we do not read. None of them is a page we can read. Export the page itself as HTML and upload that.'
    );
  });

  it('describes a zip whose pages read but paired nothing', () => {
    expect(
      describeEmptyReading(
        { kind: 'zip', files: 3, readable: 1, imageFiles: 2, otherFiles: 0 },
        t,
        'en'
      )
    ).toBe(
      'This zip holds 1 page we can read and 2 image files. Nothing in it is shaped like a card: no toggles and no question-and-answer pairs.'
    );
  });

  it('names an empty zip', () => {
    expect(
      describeEmptyReading(
        { kind: 'zip', files: 0, readable: 0, imageFiles: 0, otherFiles: 0 },
        t,
        'en'
      )
    ).toBe('This zip is empty.');
  });
});

import { strToU8, zipSync } from 'fflate';

import {
  declaredWordBodyBytes,
  MAX_CONVERTIBLE_WORD_BODY_BYTES,
  refuseWordDocumentTooLong,
  WordDocumentTooLongError,
} from './wordDocumentTooLong';
import { wordNotesWithBodyBytes } from '../../../test/fakes/longWordDocuments';
import { zipDeclaringMoreEntriesThanItHolds } from '../../../test/fakes/zipDeclaringMoreEntriesThanItHolds';

describe('declaredWordBodyBytes', () => {
  it('reads the size the zip directory declares for the Word body', () => {
    expect(declaredWordBodyBytes(wordNotesWithBodyBytes(5000))).toBe(5000);
  });

  it.each([
    ['bytes that are not a zip', Buffer.from('not a zip at all')],
    [
      'a zip with no Word body',
      Buffer.from(zipSync({ 'notes.txt': strToU8('hello') })),
    ],
  ])('has no size for %s', (_kind, contents) => {
    expect(declaredWordBodyBytes(contents)).toBeNull();
  });

  it('treats a size of 0xFFFFFFFF with no zip64 record as unknown', () => {
    const docx = Buffer.from(wordNotesWithBodyBytes(5000));
    const name = Buffer.from('word/document.xml');
    const directoryEntry = docx.lastIndexOf(name) - 46;
    expect(docx.readUInt32LE(directoryEntry)).toBe(0x02014b50);
    docx.writeUInt32LE(0xffffffff, directoryEntry + 24);

    expect(declaredWordBodyBytes(docx)).toBeNull();
  });

  it('has no size, within milliseconds, for a file declaring far more entries than it holds', () => {
    const started = performance.now();

    const declared = declaredWordBodyBytes(
      zipDeclaringMoreEntriesThanItHolds(4_000_000_000)
    );

    expect(declared).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('refuseWordDocumentTooLong', () => {
  it('refuses a Word body declared one byte over the threshold, naming its size', () => {
    const docx = wordNotesWithBodyBytes(MAX_CONVERTIBLE_WORD_BODY_BYTES + 1);

    expect(() => refuseWordDocumentTooLong(docx)).toThrow(
      expect.objectContaining({
        name: 'WordDocumentTooLongError',
        declaredBodyBytes: MAX_CONVERTIBLE_WORD_BODY_BYTES + 1,
      })
    );
  });

  it('refuses a 37 MB body, past where every measured document shape crashed', () => {
    expect(() =>
      refuseWordDocumentTooLong(wordNotesWithBodyBytes(37_000_000))
    ).toThrow(WordDocumentTooLongError);
  });

  it('is the refusal error the upload path matches by name', () => {
    expect(new WordDocumentTooLongError(1).name).toBe(
      'WordDocumentTooLongError'
    );
  });
});

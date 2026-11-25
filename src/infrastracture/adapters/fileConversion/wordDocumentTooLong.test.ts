import { strToU8, zipSync } from 'fflate';

import {
  declaredWordBodyBytes,
  MAX_CONVERTIBLE_WORD_BODY_BYTES,
  refuseWordDocumentTooLong,
  WordDocumentTooLongError,
} from './wordDocumentTooLong';
import { wordNotesWithBodyBytes } from '../../../test/fakes/longWordDocuments';

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

  it('is the refusal error the upload path matches by name', () => {
    expect(new WordDocumentTooLongError(1).name).toBe(
      'WordDocumentTooLongError'
    );
  });
});

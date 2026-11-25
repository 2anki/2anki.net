import JSZip from 'jszip';
import { strToU8, zipSync } from 'fflate';

import {
  declaredWordBodyBytes,
  MAX_CONVERTIBLE_WORD_BODY_BYTES,
  refuseWordDocumentTooLong,
  WordDocumentTooLongError,
} from './wordDocumentTooLong';
import { wordNotesWithBodyBytes } from '../../../test/fakes/longWordDocuments';
import {
  noiseWithZipEnd,
  zipDeclaringMoreEntriesThanItHolds,
  zipOfMembers,
} from '../../../test/fakes/unusualZips';

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

describe('declaredWordBodyBytes on unusual zips', () => {
  it.each([2_000_000, 8_000_000])(
    'answers within milliseconds for %i bytes of noise ending in a zip end record',
    (bytes) => {
      const noise = noiseWithZipEnd(bytes);
      const started = performance.now();

      const declared = declaredWordBodyBytes(noise);

      expect(declared).toBeNull();
      expect(performance.now() - started).toBeLessThan(20);
    }
  );

  const small = Buffer.from('<w:document/>');
  const huge = Buffer.alloc(MAX_CONVERTIBLE_WORD_BODY_BYTES + 1, 0x20);

  it.each([
    ['a small body then a huge one', [small, huge], huge.length],
    ['a huge body then a small one', [huge, small], small.length],
  ])(
    'reads the body the converter reads when a zip holds %s',
    async (_order, [first, second], expected) => {
      const zip = zipOfMembers([
        { name: 'word/document.xml', data: first },
        { name: 'word/document.xml', data: second },
      ]);
      const converterBody = await (
        await JSZip.loadAsync(zip)
      )
        .file('word/document.xml')
        ?.async('nodebuffer');

      expect(converterBody?.length).toBe(expected);
      expect(declaredWordBodyBytes(zip)).toBe(expected);
    }
  );
});

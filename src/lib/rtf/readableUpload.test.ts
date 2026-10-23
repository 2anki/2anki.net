import type { UploadedFile } from '../storage/types';
import { asReadableUpload, rtfEntryAsText } from './readableUpload';

function upload(originalname: string): UploadedFile {
  return { originalname, size: 10, key: 'k' } as unknown as UploadedFile;
}

describe('asReadableUpload', () => {
  it('turns an RTF upload into the plain-text upload of its words', () => {
    const { file, contents } = asReadableUpload(
      upload('Biology.RTF'),
      Buffer.from('{\\rtf1 Mitosis\\tab cell division\\par}', 'latin1')
    );

    expect(file.originalname).toBe('Biology.txt');
    expect(contents.toString()).toBe('Mitosis\tcell division');
  });

  it('passes every other upload through untouched', () => {
    const original = upload('notes.md');
    const contents = Buffer.from('# hi');

    expect(asReadableUpload(original, contents)).toEqual({
      file: original,
      contents,
    });
  });
});

describe('rtfEntryAsText', () => {
  it('renames a zip entry to .txt and reads its words', () => {
    expect(
      rtfEntryAsText(
        'notes/week1.rtf',
        new TextEncoder().encode('{\\rtf1 Q\\tab A\\par}')
      )
    ).toEqual({ name: 'notes/week1.txt', contents: 'Q\tA' });
  });
});

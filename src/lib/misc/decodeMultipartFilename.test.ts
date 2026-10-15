import { decodeMultipartFilename } from './decodeMultipartFilename';

function asMulterSeesIt(name: string): string {
  return Buffer.from(name, 'utf8').toString('latin1');
}

describe('decodeMultipartFilename', () => {
  it('recovers Chinese characters from latin1-decoded UTF-8 bytes', () => {
    expect(decodeMultipartFilename(asMulterSeesIt('中文.md'))).toBe('中文.md');
  });

  it('leaves ASCII filenames unchanged', () => {
    expect(decodeMultipartFilename('Biology.md')).toBe('Biology.md');
  });

  it('handles accented characters', () => {
    expect(decodeMultipartFilename(asMulterSeesIt('résumé.html'))).toBe(
      'résumé.html'
    );
  });

  it('handles Japanese filenames', () => {
    expect(decodeMultipartFilename(asMulterSeesIt('日本語.zip'))).toBe(
      '日本語.zip'
    );
  });

  it('handles Turkish dotted capital I', () => {
    const mojibake = asMulterSeesIt('PEDİATRİ.apkg');
    expect(mojibake).toBe('PEDÄ°ATRÄ°.apkg');
    expect(decodeMultipartFilename(mojibake)).toBe('PEDİATRİ.apkg');
  });

  it('leaves an already-decoded Unicode name alone', () => {
    expect(decodeMultipartFilename('PEDİATRİ.apkg')).toBe('PEDİATRİ.apkg');
    expect(decodeMultipartFilename('日本語.zip')).toBe('日本語.zip');
  });

  it('leaves a genuine latin1 name alone instead of inserting U+FFFD', () => {
    expect(decodeMultipartFilename('café.apkg')).toBe('café.apkg');
  });
});

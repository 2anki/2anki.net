import { decodeUploadImage } from './decodeUploadImage';

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('decodeUploadImage', () => {
  it('decodes a PNG buffer into base64, media type, and dimensions', () => {
    const buffer = Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64');

    const decoded = decodeUploadImage(buffer);

    expect(decoded).toEqual({
      imageBase64: ONE_BY_ONE_PNG_BASE64,
      mediaType: 'image/png',
      width: 1,
      height: 1,
    });
  });

  it('returns null for an empty buffer', () => {
    expect(decodeUploadImage(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for a non-image buffer', () => {
    expect(decodeUploadImage(Buffer.from('not an image', 'utf8'))).toBeNull();
  });

  it('returns null for a PDF buffer even though it is a real file', () => {
    const pdf = Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'binary');
    expect(decodeUploadImage(pdf)).toBeNull();
  });
});
